#!/usr/bin/env python3
"""Complete auto-layout browser suite assembled from stable and advanced cases."""
import sys
import unittest
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))

from auto_layout_browser_base import AutoLayout, ENGINE, FIXTURE, MEMORY, REPORT, ROOT
from auto_layout_advanced_cases import install

install(AutoLayout)

if __name__ == '__main__':
    unittest.main(verbosity=2)
