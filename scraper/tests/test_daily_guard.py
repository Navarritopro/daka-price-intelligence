from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import damasco
import ivoo
import multimax
import venelectronics
import soytechno


class DailyCaptureGuardTests(unittest.TestCase):
    @patch("damasco.notify_failure")
    @patch("damasco.Database")
    def test_database_start_failure_sends_alert(self, database_class, notify_failure):
        database_class.return_value.has_successful_job_today.side_effect = RuntimeError("database offline")
        with patch.dict(os.environ, {"DATABASE_URL": "postgresql://test", "TRIGGER_TYPE": "scheduled"}):
            self.assertEqual(damasco.main(), 1)
        notify_failure.assert_called_once()

    @patch("damasco.Database")
    def test_damasco_scheduled_backup_skips_existing_daily_success(self, database_class):
        database_class.return_value.has_successful_job_today.return_value = True
        with patch.dict(os.environ, {"DATABASE_URL": "postgresql://test", "TRIGGER_TYPE": "scheduled"}):
            self.assertEqual(damasco.main(), 0)
        database_class.return_value.create_job.assert_not_called()

    @patch("multimax.Database")
    def test_multimax_scheduled_backup_skips_existing_daily_success(self, database_class):
        database_class.return_value.has_successful_job_today.return_value = True
        with patch.dict(os.environ, {"DATABASE_URL": "postgresql://test", "TRIGGER_TYPE": "scheduled"}):
            self.assertEqual(multimax.main(), 0)
        database_class.return_value.create_job.assert_not_called()

    @patch("ivoo.Database")
    def test_ivoo_scheduled_backup_skips_existing_daily_success(self, database_class):
        database_class.return_value.has_successful_job_today.return_value = True
        with patch.dict(os.environ, {"DATABASE_URL": "postgresql://test", "TRIGGER_TYPE": "scheduled"}):
            self.assertEqual(ivoo.main(), 0)
        database_class.return_value.create_job.assert_not_called()

    @patch("venelectronics.Database")
    def test_venelectronics_scheduled_backup_skips_existing_daily_success(self, database_class):
        database_class.return_value.has_successful_job_today.return_value = True
        with patch.dict(os.environ, {"DATABASE_URL": "postgresql://test", "TRIGGER_TYPE": "scheduled"}):
            self.assertEqual(venelectronics.main(), 0)
        database_class.return_value.create_job.assert_not_called()

    @patch("soytechno.Database")
    def test_soytechno_scheduled_backup_skips_existing_daily_success(self, database_class):
        database_class.return_value.has_successful_job_today.return_value = True
        with patch.dict(os.environ, {"DATABASE_URL": "postgresql://test", "TRIGGER_TYPE": "scheduled"}):
            self.assertEqual(soytechno.main(), 0)
        database_class.return_value.create_job.assert_not_called()


if __name__ == "__main__":
    unittest.main()
