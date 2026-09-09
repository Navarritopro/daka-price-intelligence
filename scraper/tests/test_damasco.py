from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from damasco import DamascoScraper


class DamascoRetryTests(unittest.TestCase):
    @staticmethod
    def response(status: int, payload):
        response = Mock()
        response.status_code = status
        response.headers = {"resources": "0-49/1221"}
        response.json.return_value = payload
        if status >= 400:
            response.raise_for_status.side_effect = requests.HTTPError(
                f"{status} Server Error", response=response
            )
        return response

    @patch("damasco.time.sleep")
    def test_retries_http_500_and_recovers_without_skipping_block(self, sleep):
        scraper = DamascoScraper()
        scraper.retry_base_seconds = 0.1
        scraper.session.get = Mock(side_effect=[
            self.response(500, None),
            self.response(500, None),
            self.response(200, [{"productId": "1"}]),
        ])

        response, payload = scraper.fetch_block(1000, 1049)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload, [{"productId": "1"}])
        self.assertEqual(scraper.session.get.call_count, 3)
        self.assertEqual([call.args[0] for call in sleep.call_args_list], [0.1, 0.2])
        self.assertTrue(any("HTTP 500" in log["message"] for log in scraper.logs))

    @patch("damasco.time.sleep")
    def test_fails_after_three_attempts_instead_of_returning_partial_data(self, sleep):
        scraper = DamascoScraper()
        scraper.session.get = Mock(side_effect=[
            self.response(500, None), self.response(500, None), self.response(500, None)
        ])

        with self.assertRaisesRegex(RuntimeError, "después de 3 intentos"):
            scraper.fetch_block(1000, 1049)

        self.assertEqual(scraper.session.get.call_count, 3)
        self.assertEqual(sleep.call_count, 2)


if __name__ == "__main__":
    unittest.main()
