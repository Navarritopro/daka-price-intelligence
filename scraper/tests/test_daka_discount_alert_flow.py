import os
import sys
import unittest
from copy import deepcopy
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import scrape


class DakaDiscountAlertFlowTests(unittest.TestCase):
    def run_capture(self, settings_error=False):
        product = SimpleNamespace(external_id="DAKA-1", price_usd=Decimal("250"))
        alerts = [{"id": 1, "external_id": "DAKA-1", "name": "Producto", "url": "https://example.com/",
                   "old_price_usd": Decimal("260"), "new_price_usd": Decimal("250"), "change_pct": Decimal("-3.85")}]
        original = deepcopy(alerts)
        database = MagicMock()
        database.create_job.return_value = "job-id"
        database.save_products.return_value = 1
        database.create_alerts.return_value = alerts
        database.get_daka_display_discount.return_value = 10
        if settings_error:
            database.get_daka_display_discount.side_effect = RuntimeError("settings unavailable")
        scraper = MagicMock(logs=[], pages_scanned=1)
        scraper.run.return_value = [product]
        with patch.dict(os.environ, {"DATABASE_URL": "unused"}), \
             patch("scrape.Database", return_value=database), \
             patch("scrape.DakaScraper", return_value=scraper), \
             patch("scrape.refresh_all_matches", return_value={}), \
             patch("scrape.send_telegram", return_value=True) as telegram, \
             patch("scrape.send_email", return_value=True) as email, \
             patch("scrape.notify_failure") as failure:
            self.assertEqual(scrape.main(), 0)
            failure.assert_not_called()
            self.assertEqual(database.finish_job.call_args.kwargs["status"], "success")
            self.assertEqual(database.save_products.call_args.args[1][0].price_usd, Decimal("250"))
            self.assertEqual(alerts, original)
            if settings_error:
                telegram.assert_not_called()
                email.assert_not_called()
                database.update_alert_channels.assert_called_once_with([1], False, False)
            else:
                self.assertIn("$234.00 → $225.00", telegram.call_args.args[0])
                self.assertIn("$225.00", email.call_args.args[0])
                database.update_alert_channels.assert_called_once_with([1], True, True)

    def test_capture_keeps_original_prices_and_sends_adjusted_alert(self):
        self.run_capture()

    def test_settings_failure_does_not_invalidate_capture_or_send_misleading_prices(self):
        self.run_capture(settings_error=True)
