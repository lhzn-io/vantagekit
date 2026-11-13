# Development

```bash
npm install
npm test                       # Node, no GPU or browser needed
(cd kit && python3 -m pytest)  # Kit core: Python 3.10+, pytest, no Kit needed
python3 -m http.server 8000    # then open http://localhost:8000/demo/
```

These pages build with Sphinx:

```bash
pip install -r docs/requirements-docs.txt
sphinx-build -W -b html docs/source docs/build/html
```

## Contributing

Contributions are welcome: bug reports, gesture and controller mappings, adapters for other
renderers, and demo scenes. Open an issue to discuss a larger change, or send a pull request with
tests; the commands above run them. The modules load from a CDN with no build step, so they stay
plain ES modules with no imports beyond each other, and renderer libraries are passed in as
arguments.

## License

MIT. Copyright (c) 2026 Long Horizon Observatory.
