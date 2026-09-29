import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from health_audit import evaluate_sources


class HealthAuditTests(unittest.TestCase):
    def test_marks_recent_source_as_ok(self):
        rows = [{"slug": "daka", "name": "Daka", "last_success": datetime.now(timezone.utc)}]
        result = evaluate_sources(rows, ["daka"], 36)
        self.assertEqual(result[0]["status"], "OK")

    def test_marks_old_and_missing_sources(self):
        rows = [{
            "slug": "daka",
            "name": "Daka",
            "last_success": datetime.now(timezone.utc) - timedelta(hours=40),
        }]
        result = evaluate_sources(rows, ["daka", "ivoo"], 36)
        self.assertEqual(result[0]["status"], "ATRASADO")
        self.assertEqual(result[1]["status"], "SIN ÉXITO")


if __name__ == "__main__":
    unittest.main()
