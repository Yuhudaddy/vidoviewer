import unittest
from request_failures import expected_offline_failure, watch
from types import SimpleNamespace


class FailureFilterTests(unittest.TestCase):
    def test_only_expected_offline_failures_are_ignored(self):
        base = 'http://localhost:8767/'
        for name in ('status.json', 'manifest.webmanifest'):
            url = base + name
            self.assertTrue(expected_offline_failure(url, 'net::ERR_INTERNET_DISCONNECTED', base, True))
            self.assertFalse(expected_offline_failure(url, 'net::ERR_INTERNET_DISCONNECTED', base, False))
            self.assertFalse(expected_offline_failure(url, 'net::ERR_CONNECTION_RESET', base, True))
            self.assertFalse(expected_offline_failure(url + '?other', 'net::ERR_INTERNET_DISCONNECTED', base, True))
            self.assertFalse(expected_offline_failure('http://elsewhere/' + name, 'net::ERR_INTERNET_DISCONNECTED', base, True))
        self.assertFalse(expected_offline_failure(base + 'app.js', 'net::ERR_INTERNET_DISCONNECTED', base, True))

    def test_watch_keeps_page_console_and_other_request_errors(self):
        handlers = {}
        page = SimpleNamespace(on=lambda name, callback: handlers.update({name: callback}))
        state = {'offline': True}
        errors = watch(page, 'http://localhost:8767/', state)
        def failed(path, error):
            handlers['requestfailed'](SimpleNamespace(url='http://localhost:8767/' + path, failure=error))
        failed('status.json', 'net::ERR_INTERNET_DISCONNECTED')
        failed('app.js', 'net::ERR_INTERNET_DISCONNECTED')
        failed('status.json', 'net::ERR_CONNECTION_RESET')
        state['offline'] = False
        failed('manifest.webmanifest', 'net::ERR_INTERNET_DISCONNECTED')
        handlers['pageerror'](RuntimeError('page failure'))
        handlers['console'](SimpleNamespace(type='error', text='console failure', location={'url': 'example'}))
        self.assertEqual(len(errors), 5)
        self.assertTrue(any('page failure' in error for error in errors))
        self.assertTrue(any('console failure' in error for error in errors))


if __name__ == '__main__':
    unittest.main()
