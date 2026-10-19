# Naming, trademark, and content policy

Ultimate Crashout is an independent platform fighter. The project must never be
presented as a sequel, port, remake, or product affiliated with an existing
franchise.

This document is a technical publishing policy, not legal advice. Before
commercialization, fundraising, or filing a trademark application, have the
name and product reviewed by an intellectual property professional in the
relevant countries.

## Name and identity

- The public name is **Ultimate Crashout**. The project is a fork of the
  MIT-licensed **Super Bash Folds**; that name may appear only in attribution,
  the license notice, and historical records.
- The logo must not reproduce another game's symbol, typography, or visual
  composition.
- Public pages use only "platform fighter" to describe the genre. Third-party
  trademarks (including any "Smash" or "Super Smash Bros." reference) must not
  be used as subtitles, promotional keywords, store tags, or mode names.
- **No clearance search has been done for "Ultimate Crashout".** Note the
  specific risk: "Super Smash Bros. Ultimate" is a registered, actively
  enforced mark in the same genre and channel. "Ultimate" alone is a common,
  weak term, but pairing it with Smash-like presentation (logo treatment, a
  rhyming "-ash" word, comparative marketing) increases the likelihood-of-
  confusion argument. Run a USPTO/EUIPO search for similar signs in classes 9
  and 41 before any commercial release.

Official references:

- [EUIPO — check trademark availability](https://www.euipo.europa.eu/uk/trade-marks/before-applying/availability)
- [EUIPO — limitations of an availability search](https://www.euipo.europa.eu/en/help-centre/tm/faq-search-availability)

## Permitted public content

Every distributed asset must have a source, author, compatible license, record
of transformations, and hash. A license covering the file is not enough if the
file reproduces a character, logo, music, or other identity that its author does
not own.

Gameplay mechanics and methods may inspire the genre, but their audiovisual
expression must remain original. The U.S. Copyright Office distinguishes game
methods, which are not protected by copyright, from graphic or literary
elements, which may be protected:
[Games](https://www.copyright.gov/register/tx-games.html).

## Content prohibited from Git and releases

- Models, textures, animations, sprites, sounds, music, voices, effects,
  screenshots, or data extracted from a commercial game.
- Conversions or renders derived from those files.
- Game archives, extraction tools and scripts, internal path manifests, or
  data-mining instructions.
- Logos, names, or branding likely to imply affiliation.
- Secrets, machine paths, personal data, and account files.

Fan-content or media-sharing policies do not authorize redistribution of
extracted files, derivative asset packs, or unlicensed software. Contributors
must obtain explicit permission for every asset that is not covered by a
compatible open license.

## Local overlay

A maintainer may keep an overlay ignored by Git on their own machine. This
overlay is not a distributed feature, is not covered by the repository license,
and must not appear in a release, promotional screenshot, or issue. Public
commands remain the only supported contribution and CI surface.

## Checks before publishing

```sh
npm run check:public-assets
npm run check:public-history
npm run build:public
npm run check:public-dist
```

Checking the working tree is not enough: a deleted file remains in Git history.
If prohibited content has already been published, stop releases, rewrite every
affected reference, force-replace the remote branches and tags, and ask
contributors to clone the repository again.
