"""僅排除測試主動切為離線時，預期會失敗的非快取資源。"""
from urllib.parse import urljoin


def expected_offline_failure(url, failure, base_url, offline):
    expected_urls = {urljoin(base_url, './status.json'), urljoin(base_url, './manifest.webmanifest')}
    return offline is True and failure == 'net::ERR_INTERNET_DISCONNECTED' and url in expected_urls


def watch(page, base_url, offline_state=None):
    errors = []
    offline_state = offline_state if offline_state is not None else {'offline': False}
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('console', lambda message: errors.append(message.text + ' @ ' + str(message.location.get('url'))) if message.type == 'error' else None)

    def request_failed(request):
        if not expected_offline_failure(request.url, request.failure, base_url, offline_state['offline']):
            errors.append('requestfailed ' + request.url + ' ' + str(request.failure))

    page.on('requestfailed', request_failed)
    return errors
