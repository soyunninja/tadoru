# Bundled font

`jetbrains-mono-subset.woff2` is a subset of **JetBrains Mono** patched by the **Nerd Fonts**
project. It carries text glyphs plus the icons the dashboard interface uses.

## JetBrains Mono — SIL Open Font License 1.1

- Copyright 2020 The JetBrains Mono Project Authors — https://github.com/JetBrains/JetBrainsMono
- The licence is declared by the font file itself, in its `name` table (IDs 13 and 14). The full
  text ships alongside as [`OFL.txt`](OFL.txt), as the licence requires.
- The copyright declares no Reserved Font Name, so a subset may be redistributed under the OFL
  without renaming.
- JetBrains Mono is a trademark of JetBrains s.r.o. Bundling the font implies no endorsement.

## Icon glyphs — Font Awesome, CC BY 4.0

The interface icons come from the Font Awesome range of the Nerd Fonts patch
(`U+F000`–`U+F2FF`), which the [Nerd Fonts licence audit][audit] records as **CC BY 4.0**:

| Codepoint | Icon       | Used for            |
|-----------|------------|---------------------|
| `U+F0C0`  | users      | Visitors            |
| `U+F06E`  | eye        | Pageviews           |
| `U+F24D`  | clone      | Sessions            |
| `U+F08B`  | sign-out   | Bounce rate         |
| `U+F017`  | clock      | Average engagement  |
| `U+F179`  | apple      | iOS and macOS       |
| `U+F17A`  | windows    | Windows             |
| `U+F17B`  | android    | Android             |
| `U+F17C`  | linux      | Linux distributions |
| `U+F268`  | chrome     | Chrome OS, Chrome   |
| `U+F269`  | firefox    | Firefox             |
| `U+F267`  | safari     | Safari              |
| `U+F26A`  | opera      | Opera               |
| `U+F282`  | edge       | Edge                |
| `U+F26B`  | ie         | Internet Explorer   |
| `U+F108`  | desktop    | Desktop devices     |
| `U+F10B`  | mobile     | Phones              |
| `U+F10A`  | tablet     | Tablets             |
| `U+F26C`  | television | TV devices          |
| `U+F120`  | terminal   | Automated clients   |

The platform marks identify the operating system a visit came from. Those names and logos are
trademarks of their respective owners; using them to identify the product they denote implies no
affiliation or endorsement.

**Font Logos (`U+F300` and above) is deliberately not used.** It carries nicer distribution marks,
but the Nerd Fonts licence audit records it as unlicensed, and redistributing artwork on unknown
terms is not worth a prettier penguin. A test asserts every icon sits inside the attributed
`U+F000`–`U+F2FF` range.

**Attribution, as CC BY 4.0 requires:** icons by [Font Awesome](https://fontawesome.com), licensed
under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). They are bundled unmodified, as
patched into the font by the [Nerd Fonts](https://github.com/ryanoasis/nerd-fonts) project, which
distributes its patched fonts under SIL OFL 1.1.

[audit]: https://github.com/ryanoasis/nerd-fonts/blob/master/license-audit.md

## Why the font is bundled at all

Referencing the font by name only works on machines where someone installed it. These icons live
in Unicode's Private Use Area, so without the font they render as empty boxes rather than as
nothing — a worse failure than plain text.

Bundling a subset costs about 30 KB, cached for a year, and every operator sees the same
interface. The unsubsetted source file is 2.5 MB, almost all of it icon glyphs this project does
not use.

Regenerate with `npm run build:font`, which lists the exact character set and codepoints.
