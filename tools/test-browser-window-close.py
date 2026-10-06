#!/usr/bin/env python3
"""Regression contracts for real popup-close test synchronization.

These test only event ordering; the unchanged browser suite still verifies real
Ctrl+F4, window ownership, cleanup, modeless tools and all other window behavior.
"""
import importlib.util
from pathlib import Path
import unittest

from playwright.sync_api import Error, TimeoutError as PlaywrightTimeoutError

spec = importlib.util.spec_from_file_location(
    'browser_windows_tests', Path(__file__).with_name('browser-windows-tests.py'))
windows = importlib.util.module_from_spec(spec)
spec.loader.exec_module(windows)


class Popup:
    def __init__(self, deliver_close=True):
        self.closed = False
        self.deliver_close = deliver_close
        self.subscribed = False
        self.waited = False

    def is_closed(self):
        return self.closed

    def expect_event(self, event):
        if event != 'close':
            raise AssertionError('Must subscribe to this popup closing')
        popup = self

        class PendingClose:
            def __enter__(self):
                popup.subscribed = True
                return self

            def __exit__(self, kind, error, trace):
                if kind is not None:
                    return False
                popup.waited = True
                if not popup.deliver_close:
                    raise PlaywrightTimeoutError('No close event was delivered')
                popup.closed = True
                return False

        return PendingClose()


class CloseActionContract(unittest.TestCase):
    def close(self, popup, action):
        windows.BrowserWindows.closing_action(self, popup, action)

    def test_successful_action_still_waits_for_close(self):
        popup = Popup()
        self.close(popup, lambda: self.assertTrue(popup.subscribed))
        self.assertTrue(popup.waited)
        self.assertTrue(popup.closed)

    def test_input_error_can_precede_close_notification(self):
        popup = Popup()

        def action():
            self.assertTrue(popup.subscribed)
            self.assertFalse(popup.is_closed())
            raise Error('Keyboard.press: Protocol error (Input.dispatchKeyEvent): Page closed')

        self.close(popup, action)
        self.assertTrue(popup.waited)
        self.assertTrue(popup.closed)

    def test_close_notification_can_precede_input_error(self):
        popup = Popup()

        def action():
            popup.closed = True
            raise Error('Target page, context or browser has been closed')

        self.close(popup, action)
        self.assertTrue(popup.waited)

    def test_unrelated_input_error_is_not_swallowed(self):
        popup = Popup()

        def action():
            popup.closed = True
            raise Error('Input dispatch failed for an unrelated reason')

        with self.assertRaisesRegex(Error, 'unrelated reason'):
            self.close(popup, action)
        self.assertFalse(popup.waited)

    def test_closed_error_does_not_replace_a_real_close_event(self):
        popup = Popup(deliver_close=False)

        def action():
            raise Error('Page closed')

        with self.assertRaisesRegex(PlaywrightTimeoutError, 'No close event'):
            self.close(popup, action)
        self.assertTrue(popup.waited)
        self.assertFalse(popup.closed)


if __name__ == '__main__':
    unittest.main(verbosity=2)
