"""Bounded, expectation-independent stabilization for exact pixel assertions."""
from collections.abc import Callable
from PIL import Image


def capture_stable_pixels(capture: Callable[[], Image.Image], *, max_captures: int = 5) -> Image.Image:
    """Return the second of two consecutive byte-identical captures.

    No baseline is consulted and no pixels are averaged, masked, aligned,
    converted or resampled. A permanently wrong image remains wrong when the
    caller compares it to its independent expectation. Geometry/mode changes
    and nonconverging paint are failures, not reasons to loosen comparison.

    This follows Playwright's consecutive-screenshot stabilization contract:
    https://playwright.dev/docs/api/class-pageassertions#page-assertions-to-have-screenshot-1
    """
    if isinstance(max_captures, bool) or not isinstance(max_captures, int) or max_captures < 2:
        raise ValueError('max_captures must be an integer of at least 2')
    previous = capture()
    if previous.mode not in {'RGB', 'RGBA'}:
        raise ValueError('Pixel stabilization requires RGB or RGBA captures')
    size, mode = previous.size, previous.mode
    # Snapshot bytes now: the callback may reuse and mutate the same image.
    previous_pixels = previous.tobytes()
    for _ in range(1, max_captures):
        current = capture()
        if current.size != size or current.mode != mode:
            raise AssertionError(
                f'Capture geometry or mode changed: {size}/{mode} -> {current.size}/{current.mode}')
        pixels = current.tobytes()
        if pixels == previous_pixels:
            return current
        previous_pixels = pixels
    raise AssertionError(f'Pixels did not stabilize in {max_captures} captures')
