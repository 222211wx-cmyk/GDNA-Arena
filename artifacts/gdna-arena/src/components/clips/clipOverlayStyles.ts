// Shared CSS for the clip action overlay (vertical right rail + left-bottom
// meta) and the three-dot menu. Built from design-system tokens only.
// `palette` is tokens.color.dark; `space` is the base spacing step.

type Palette = Record<string, string>;

export function clipOverlayCss(palette: Palette, space: string): string {
  return `
  /* The overlay sits inside the media frame so the rail floats over media. */
  .clip-media-frame .video-actions-shell,
  #player-media .video-actions-shell{position:static}
  .video-actions-shell{display:block}

  /* Letterbox presentation frame: on narrow landscape a natural video is only
     ~184px tall, which clips the top of the 5-icon rail (rail height + bottom
     80px). Give video frames a >=360px black presentation box and contain the
     video inside it so every icon and the menu fit. Native controls preserved. */
  .clip-media-frame:has(video),
  #player-media:has(video){min-height:360px;background:${palette.background};display:flex}
  .clip-media-frame:has(video) video,
  #player-media:has(video) video{width:100%;height:auto;min-height:360px;max-height:72vh;object-fit:contain;background:${palette.background};margin:auto}

  .clip-overlay{position:absolute;inset:0;pointer-events:none;z-index:3;direction:ltr}
  /* Audio: static block (not an overlay) rendered below the native controls. */
  .clip-overlay-static{position:static;pointer-events:auto;direction:ltr;display:grid;gap:calc(${space} * 3);margin-top:calc(${space} * 3)}

  /* Vertical right rail: physical right 16px, bottom 80px, gap 20px so the
     RTL root does not flip it to the left. Clears the native control bar. */
  .clip-rail{
    position:absolute;
    right:16px;
    bottom:80px;
    display:flex;
    flex-direction:column;
    align-items:center;
    gap:20px;
    pointer-events:auto;
  }

  .clip-rail-btn{
    display:flex;
    flex-direction:column;
    align-items:center;
    gap:calc(${space} * 1);
    padding:0;
    margin:0;
    border:0;
    background:transparent;
    color:#ffffff;
    cursor:pointer;
    line-height:1;
    filter:drop-shadow(0 1px 3px rgba(0,0,0,.7));
    -webkit-tap-highlight-color:transparent;
  }
  .clip-rail-icon{display:inline-flex;width:28px;height:28px}
  .clip-rail-icon svg{width:28px;height:28px}
  .clip-rail-count{font-size:.75rem;font-weight:700;color:#ffffff}
  /* Icons stay white per spec; the filled (vs outline) glyph indicates the
     active state — active never switches to gold. */
  .clip-rail-btn,.clip-rail-btn.active{color:#ffffff}
  .clip-rail-btn:hover{opacity:.85}
  .clip-rail-btn:focus-visible{outline:2px solid ${palette.ring};outline-offset:3px;border-radius:${space}}
  .clip-rail-btn:disabled{opacity:.5;cursor:not-allowed}

  /* Left-bottom meta: author, title, audio label. Physical left/right so it is
     not flipped by the RTL root; caption reads left-to-right. */
  .clip-meta{
    position:absolute;
    left:16px;
    bottom:80px;
    right:72px;
    max-width:min(70%,32rem);
    display:grid;
    gap:calc(${space} * 1);
    color:#ffffff;
    text-align:left;
    direction:ltr;
    pointer-events:auto;
    text-shadow:0 1px 3px rgba(0,0,0,.8);
  }
  .clip-meta-author{font-weight:700;font-size:.95rem}
  .clip-meta-author-link{color:#ffffff;text-decoration:none;font-weight:700}
  .clip-meta-author-link:hover{text-decoration:underline}
  .clip-meta-author-link:focus-visible{outline:2px solid ${palette.ring};outline-offset:2px;border-radius:${space}}
  .clip-meta-title{margin:0;font-size:.9rem;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .clip-meta-audio{margin:0;font-size:.75rem;color:${palette.mutedForeground};font-weight:600;letter-spacing:.02em}

  /* Three-dot menu popover. */
  .clip-menu-wrap{position:relative;display:flex;flex-direction:column;align-items:center}
  .clip-menu{
    position:absolute;
    bottom:calc(100% + calc(${space} * 2));
    right:0;
    direction:ltr;
    min-width:12rem;
    background:${palette.popover};
    color:${palette.popoverForeground};
    border:1px solid ${palette.border};
    border-radius:${space};
    padding:calc(${space} * 1);
    display:grid;
    gap:calc(${space} * 0.5);
    box-shadow:0 8px 24px rgba(0,0,0,.55);
    z-index:5;
  }
  .clip-menu-item{
    display:flex;
    align-items:center;
    gap:calc(${space} * 2);
    inline-size:100%;
    padding:calc(${space} * 2) calc(${space} * 3);
    background:transparent;
    color:${palette.popoverForeground};
    border:0;
    border-radius:${space};
    font-weight:600;
    font-size:.875rem;
    text-align:left;
    cursor:pointer;
  }
  .clip-menu-icon{display:inline-flex;inline-size:20px;block-size:20px;color:${palette.mutedForeground}}
  .clip-menu-icon svg{inline-size:20px;block-size:20px}
  .clip-menu-item:hover,.clip-menu-item:focus-visible{background:${palette.secondary};outline:none}
  .clip-menu-item:focus-visible{outline:2px solid ${palette.ring};outline-offset:-2px}
  .clip-menu-item.active{color:${palette.primary}}
  .clip-menu-item:disabled{opacity:.5;cursor:not-allowed}

  .action-status{margin-block:calc(${space} * 2)}
  .clip-comments,.comment-list{display:grid;gap:calc(${space} * 2);margin-block-start:calc(${space} * 2)}

  /* Static audio layout: meta first, then a horizontal icon row below the
     native <audio> controls. No overlay, all controls preserved. */
  .clip-overlay-static .clip-meta{
    position:static;left:auto;right:auto;bottom:auto;max-width:100%;
    text-shadow:none;color:${palette.foreground};direction:ltr;text-align:left;
  }
  .clip-overlay-static .clip-meta-author,
  .clip-overlay-static .clip-meta-title{color:${palette.foreground}}
  .clip-overlay-static .clip-meta-author-link{color:${palette.primary}}
  .clip-overlay-static .clip-meta-audio{color:${palette.mutedForeground}}
  .clip-overlay-static .clip-rail{
    position:static;flex-direction:row;justify-content:flex-start;flex-wrap:wrap;
    align-items:flex-start;gap:20px;
  }
  .clip-overlay-static .clip-rail-btn,
  .clip-overlay-static .clip-rail-btn.active{color:${palette.foreground};filter:none}
  .clip-overlay-static .clip-rail-count{color:${palette.mutedForeground}}
  .clip-overlay-static .clip-menu{
    background:${palette.popover};color:${palette.popoverForeground};
    border:1px solid ${palette.border};
  }

  /* Keep the exact requested 16 / 80 / 20 rail geometry on mobile too. */
  @media (max-width:768px){
    .clip-rail{right:16px;bottom:80px;gap:20px}
    .clip-meta{left:16px;bottom:80px;right:72px}
  }
  `;
}
