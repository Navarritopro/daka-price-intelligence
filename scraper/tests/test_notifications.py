import sys
import unittest
from pathlib import Path
from unittest.mock import patch
from decimal import Decimal
from copy import deepcopy

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from notifications import _safe_error, notify_failure, send_telegram, build_messages
from database import Database


class NotificationTests(unittest.TestCase):
    def test_daka_alert_discounts_a_copy_without_mutating_captured_alerts(self):
        alerts = [{"external_id": "DAKA-1", "name": "Producto", "url": "https://example.com/",
                   "old_price_usd": Decimal("260"), "new_price_usd": Decimal("250"), "change_pct": Decimal("-3.85")}]
        original = deepcopy(alerts)
        text, html = build_messages(alerts, daka_discount_percentage=10)
        self.assertIn("$234.00 → $225.00", text)
        self.assertIn("descuento -10%", text)
        self.assertIn("$225.00", html)
        self.assertEqual(alerts, original)
        self.assertIn("$260.00 → $250.00", build_messages(alerts)[0])

    def test_daka_alert_handles_cent_rounding_and_rejects_100_percent(self):
        alerts = [{"external_id": "DAKA-1", "name": "Producto", "url": "https://example.com/",
                   "old_price_usd": Decimal("0.01"), "new_price_usd": Decimal("0.02"), "change_pct": Decimal("100")}]
        self.assertIn("sin base comparable", build_messages(alerts, daka_discount_percentage=99)[0])
        with self.assertRaises(ValueError):
            build_messages(alerts, daka_discount_percentage=100)

    @patch.object(Database, "_connect")
    def test_alert_settings_are_read_without_changing_scraping(self, connect):
        connection = connect.return_value.__enter__.return_value
        connection.execute.return_value.fetchone.return_value = {"percentage": 10}
        self.assertEqual(Database("unused").get_daka_display_discount(), 10)
        sql = connection.execute.call_args.args[0]
        self.assertIn("SELECT", sql)
        self.assertIn("source_slug = 'daka'", sql)
        self.assertNotIn("UPDATE", sql)
        connection.execute.return_value.fetchone.return_value = None
        with self.assertRaises(RuntimeError):
            Database("unused").get_daka_display_discount()

    @patch("notifications.requests.post")
    @patch.dict("os.environ", {"TELEGRAM_BOT_TOKEN": "token", "TELEGRAM_CHAT_ID": "chat"})
    def test_telegram_adds_inline_button_to_message(self, post):
        post.return_value.raise_for_status.return_value = None
        sent = send_telegram(
            "Resumen",
            buttons=[{"text": "Ver variaciones", "url": "https://example.com/?source=daka"}],
        )
        self.assertTrue(sent)
        payload = post.call_args.kwargs["json"]
        self.assertEqual(
            payload["reply_markup"]["inline_keyboard"][0][0],
            {"text": "Ver variaciones", "url": "https://example.com/?source=daka"},
        )

    def test_safe_error_removes_database_credentials(self):
        error = RuntimeError(
            "connection failed for postgresql://do_admin:secret-password@example.com:25060/app"
        )
        safe = _safe_error(error)
        self.assertNotIn("secret-password", safe)
        self.assertIn("postgresql://***@example.com", safe)

    @patch("notifications.send_email", return_value=True)
    @patch("notifications.send_telegram", return_value=True)
    def test_failure_alert_uses_both_channels(self, telegram, email):
        result = notify_failure("Daka", RuntimeError("fallo controlado"), "local")
        self.assertEqual(result, {"telegram": True, "email": True})
        telegram.assert_called_once()
        email.assert_called_once()

    @patch("notifications.send_email", side_effect=RuntimeError("smtp offline"))
    @patch("notifications.send_telegram", return_value=False)
    def test_notification_failure_does_not_raise(self, _telegram, _email):
        result = notify_failure("Daka", RuntimeError("fallo controlado"), "local")
        self.assertEqual(result, {"telegram": False, "email": False})


if __name__ == "__main__":
    unittest.main()
