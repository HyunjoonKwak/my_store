// detail.html checks and conversion to a Naver detailContent fragment.
// The validator mirrors Desk's export rules (no script-capable elements,
// event attributes, links or resource-loading CSS; images only from the
// package) so a ZIP from anywhere else gets the same treatment.
// Naver detail content is an HTML fragment styled inline, so <style>
// rules are inlined and only the <body> content is kept. The converted
// fragment is validated again because serializers can disagree with the
// parser that checked the input.

import { load } from 'cheerio'
import juice from 'juice'
import { ExchangeError } from './format.ts'

const UNSAFE_ELEMENTS = new Set([
  'script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'base', 'link',
  'form', 'svg', 'math', 'template', 'portal', 'noscript',
  // Raw-text elements: their content re-parses as markup in other parsers
  'xmp', 'noembed', 'noframes', 'plaintext', 'textarea',
])
const URL_ATTRIBUTES = new Set([
  'srcset', 'poster', 'background', 'action', 'formaction', 'xlink:href', 'data', 'cite',
  'longdesc', 'ping', 'lowsrc', 'dynsrc',
])

const REFUSED = '스크립트, 이벤트 속성 또는 외부 주소가 들어 있는 상세페이지는 가져올 수 없습니다.'

/** Lower-case and drop the whitespace/control characters browsers ignore in URLs. */
function compact(value: string): string {
  return value.toLowerCase().replace(/[\u0000- \u007f]/g, '')
}

export function unsafeCss(css: string): boolean {
  // CSS escapes ("\75 rl(") can spell any token; templates never need them
  if (css.includes('\\')) return true
  const clean = compact(css)
  return ['url(', '@import', 'expression(', 'behavior:', 'image-set(', '-moz-binding'].some((token) =>
    clean.includes(token)
  )
}

/** Throws unless the page only uses the given image sources and passive markup. */
export function validateDetailHtml(html: string, allowedSources: Set<string>): void {
  const $ = load(html)
  let error: string | null = null

  $('style').each((_, element) => {
    if (unsafeCss($(element).text())) error = REFUSED
  })

  $('*').each((_, element) => {
    // domhandler types <script>/<style> separately from other tags
    if (error || !('attribs' in element)) return
    const name = element.name.toLowerCase()
    if (UNSAFE_ELEMENTS.has(name)) {
      error = REFUSED
      return
    }
    for (const [rawKey, rawValue] of Object.entries(element.attribs)) {
      const key = rawKey.toLowerCase()
      const value = compact(rawValue)
      if (key.startsWith('on') || URL_ATTRIBUTES.has(key)) error = REFUSED
      else if (name === 'meta' && key === 'http-equiv') error = REFUSED
      else if (key === 'style' && unsafeCss(rawValue)) error = REFUSED
      else if (key === 'href' && value !== '' && value !== '#') error = REFUSED
      else if (key === 'src' && !allowedSources.has(rawValue.trim())) {
        error = `패키지에 없는 사진 경로가 있습니다: ${rawValue.slice(0, 80)}`
      }
      if (error) return
    }
  })

  if (error) throw new ExchangeError(error)
}

/** Package image paths the page actually shows, in document order. */
export function referencedImages(html: string): string[] {
  const $ = load(html)
  const paths = $('[src]')
    .map((_, element) => ($(element).attr('src') || '').trim())
    .get()
  return [...new Set(paths)]
}

/**
 * Inlines <style> rules, keeps the <body> content inside a wrapper that
 * carries the body's own styles, and points image paths at uploaded URLs.
 * Pseudo-elements and media queries cannot be inlined and are dropped.
 */
export function toNaverDetailContent(html: string, imageUrls: Map<string, string>): string {
  const inlined = juice(html, {
    removeStyleTags: true,
    preserveMediaQueries: false,
    preserveFontFaces: false,
    preserveKeyFrames: false,
    preservePseudos: false,
    insertPreservedExtraCss: false,
    applyWidthAttributes: false,
    applyHeightAttributes: false,
    applyAttributesTableElements: false,
  })

  const $ = load(inlined)
  $('[src]').each((_, element) => {
    const node = $(element)
    const url = imageUrls.get((node.attr('src') || '').trim())
    if (!url) throw new ExchangeError('업로드하지 못한 사진이 남아 있습니다.')
    node.attr('src', url)
  })
  $('[class]').removeAttr('class')
  $('[id]').removeAttr('id')
  $('style, meta, title').remove()
  $('*')
    .contents()
    .filter((_, node) => node.type === 'comment')
    .remove()

  const body = $('body')
  const bodyStyle = body.attr('style') || ''
  const inner = (body.html() || '').trim()
  if (!inner) throw new ExchangeError('상세페이지 내용이 비어 있습니다.')

  const wrapper = $('<div></div>').html(inner)
  if (bodyStyle) wrapper.attr('style', bodyStyle)
  const fragment = $.html(wrapper)

  validateDetailHtml(fragment, new Set(imageUrls.values()))
  return fragment
}
