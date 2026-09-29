import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from notifications import _safe_error, notify_failure, send_telegram


class NotificationTests(unittest.TestCase):
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
