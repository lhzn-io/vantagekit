# Configuration file for the Sphinx documentation builder.
# https://www.sphinx-doc.org/en/master/usage/configuration.html

import os
import sys

# The Python package lives in the Kit extension folder; vantagekit.core is standard library only.
sys.path.insert(0, os.path.abspath("../../kit/exts/lhzn.vantagekit"))

from vantagekit import __version__  # noqa: E402

project = "vantagekit"
copyright = "2026, Long Horizon Observatory"
author = "Long Horizon Observatory"
release = __version__
version = ".".join(__version__.split(".")[:2])

extensions = [
    "sphinx.ext.autodoc",
    "sphinx.ext.napoleon",
    "sphinx.ext.viewcode",
    "sphinx_rtd_theme",
    "myst_parser",
]

myst_enable_extensions = ["colon_fence", "deflist", "fieldlist"]
myst_heading_anchors = 3

# vantagekit.kit imports Kit modules that exist only inside Omniverse Kit.
autodoc_mock_imports = ["carb", "omni", "pxr"]
autodoc_member_order = "bysource"
autodoc_typehints = "description"
napoleon_google_docstring = True
napoleon_numpy_docstring = False

templates_path = ["_templates"]
exclude_patterns: list[str] = []

language = "en"

html_theme = "sphinx_rtd_theme"
html_title = f"vantagekit {release}"
html_logo = "../logo.svg"
html_favicon = "../../demo/favicon.svg"
html_static_path = ["_static"]
html_css_files = ["custom.css"]
# CNAME for the custom domain vantagekit.docs.lhzn.io, copied to the site root.
html_extra_path = ["_extra"]
html_show_sourcelink = False
