"""Independent CSS source-over reference for portable theme-layer assertions.

AppKit equality is verified separately by macos_theme_compare, without masks or
pixel tolerances. Canvas2D is not the compositor used to rasterize CSS controls;
using it here introduced a second alpha parser/quantization path on WebKit.
"""
import io
from PIL import Image


def rasterize_css_layers(page, background, layers):
    """Rasterize literal reference colors in a style-isolated, noninteractive swatch.

    No production selector, custom property, or sampled component pixel is used
    to derive the reference. The shadow subtree excludes global application CSS;
    explicit initial values isolate inherited geometry and rendering effects.
    A string layer paints a solid color; {"image": CSS} paints an independently
    specified gradient. Gradient color stops and solid backgrounds can follow
    different premultiplied-alpha quantization paths in the same browser.
    The host is in the body, below the retained paint plane, like the controls.
    Its closed shadow root keeps it a browser-native island. Appending above that
    plane would introduce a different compositor group and another quantization.
    """
    handle = page.evaluate_handle("""([background, layers]) => {
        const host = document.createElement('div');
        host.setAttribute('aria-hidden', 'true');
        host.style.cssText = 'all:initial;position:fixed;left:0;top:0;width:16px;height:16px;'
            + 'display:block;z-index:2147482999;pointer-events:none;contain:strict;isolation:isolate';
        const shadow = host.attachShadow({mode:'closed'});
        const surface = document.createElement('div');
        surface.style.cssText = 'all:initial;display:block;position:relative;width:16px;height:16px';
        surface.style.backgroundColor = background;
        if (!surface.style.backgroundColor) throw Error('Invalid reference background');
        for (const paint of layers) {
            const layer = document.createElement('div');
            layer.style.cssText = 'all:initial;display:block;position:absolute;inset:0';
            if (typeof paint === 'string') {
                layer.style.backgroundColor = paint;
                if (!layer.style.backgroundColor) throw Error('Invalid reference color: '+paint);
            } else if (paint && Object.keys(paint).length === 1 && typeof paint.image === 'string'
                    && /^linear-gradient\\(/i.test(paint.image) && !/url\\(/i.test(paint.image)) {
                layer.style.backgroundImage = paint.image;
                if (!layer.style.backgroundImage) throw Error('Invalid reference gradient: '+paint.image);
            } else {
                throw Error('Expected a color or a literal linear-gradient reference');
            }
            surface.append(layer);
        }
        shadow.append(surface); document.body.append(host);
        return host;
    }""", [background, layers])
    try:
        with Image.open(io.BytesIO(handle.as_element().screenshot())) as image:
            rgb = image.convert('RGB')
            return list(rgb.getpixel((rgb.width // 2, rgb.height // 2)))
    finally:
        handle.evaluate('(node) => node.remove()')
        handle.dispose()
