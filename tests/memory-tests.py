#!/usr/bin/env python3
"""CPU-only checks of stage 2's system RAM policy; no installs or GPU use."""
import os
import pathlib
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


class HostMemory(unittest.TestCase):
    def check_ram(self, kib, override=None):
        env = os.environ.copy()
        env.pop('QWEN_ALLOW_LOW_RAM', None)
        if override is not None:
            env['QWEN_ALLOW_LOW_RAM'] = override
        return subprocess.run(
            ['bash', '-c', 'source "$1/lib/common.sh"; check_host_ram "$2"',
             'memory-test', str(ROOT), str(kib)],
            env=env, capture_output=True, text=True,
        )

    def test_reported_machine_requires_explicit_opt_in(self):
        result = self.check_ram(101708100)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('97.0 GiB', result.stderr)
        self.assertIn('120 GiB', result.stderr)
        self.assertIn('QWEN_ALLOW_LOW_RAM=1', result.stderr)

    def test_reported_machine_can_opt_in_with_warning(self):
        result = self.check_ram(101708100, '1')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('97.0 GiB', result.stdout)
        self.assertIn('WARNING', result.stderr)
        self.assertIn('out of host RAM', result.stderr)

    def test_cutoff_is_preserved(self):
        self.assertNotEqual(self.check_ram(120 * 1024**2 - 1).returncode, 0)
        result = self.check_ram(120 * 1024**2)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn('WARNING', result.stderr)

    def test_zero_does_not_bypass_guard(self):
        self.assertNotEqual(self.check_ram(101708100, '0').returncode, 0)

    def test_invalid_override_is_rejected(self):
        for value in ['true', 'yes', '2']:
            with self.subTest(value=value):
                result = self.check_ram(128 * 1024**2, value)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('must be 0 or 1', result.stderr)

    def test_unreadable_or_invalid_ram_cannot_be_bypassed(self):
        for value in ['', '0', 'unknown', '-1']:
            with self.subTest(value=value):
                result = self.check_ram(value, '1')
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('Cannot determine host RAM', result.stderr)


if __name__ == '__main__':
    unittest.main(verbosity=2)
