import glob, os
V = '/home/claude/vendor'
FILES = {}
def _f(fam, pkg, base, w, style='normal'):
    fn = f'{base}-latin-{w}-{style}.woff2'
    path = glob.glob(f'{V}/fontsource-{pkg}-*/package/files/{fn}')[0]
    FILES[fn] = path
    return f"@font-face{{font-family:'{fam}';font-style:{style};font-weight:{w};src:url(https://fonts.gstatic.com/local/{fn}) format('woff2');}}"
CSS = ''.join([_f('Anton','anton','anton',400), _f('Bebas Neue','bebas-neue','bebas-neue',400),
  _f('Lora','lora','lora',400), _f('Lora','lora','lora',400,'italic')] + [_f('Inter','inter','inter',w) for w in (300,400,500,600,700)])
def install(ctx):
    ctx.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(status=200, content_type='text/css', headers={'Access-Control-Allow-Origin':'*'}, body=CSS))
    ctx.route('https://fonts.gstatic.com/**', lambda r: r.fulfill(status=200, content_type='font/woff2', headers={'Access-Control-Allow-Origin':'*'}, body=open(FILES[r.request.url.rsplit('/',1)[1]],'rb').read()))
