"""
tests/conftest.py – shared pytest configuration.

Integration tests (marked with @pytest.mark.integration) are skipped by
default. Pass --integration to opt in:

    uv run pytest --integration tests/test_integration.py -v
"""
import pytest


def pytest_addoption(parser: pytest.Parser) -> None:
    parser.addoption(
        "--integration",
        action="store_true",
        default=False,
        help="Run integration tests that make real Gemini API calls.",
    )


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    if not config.getoption("--integration"):
        skip = pytest.mark.skip(reason="Pass --integration to run this test.")
        for item in items:
            if item.get_closest_marker("integration"):
                item.add_marker(skip)


@pytest.fixture(autouse=True)
def disable_auth_for_backend_tests(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep existing unit tests focused on route behavior, not auth wiring."""
    monkeypatch.setattr("app.security.supabase_jwt.settings.auth_required", False)
