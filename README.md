# <image alt="GMaul" width="200" src="https://user-images.githubusercontent.com/164050/209837927-35473a43-cc60-487c-abaa-d28f2543e404.png" />

***An IMAP agent for more-better spam filtering***

I've had the same email address for ~20 years, and it's been publicly available most of that time.  As a result, I get a **lot** of spam.  For a long time that wasn't a big deal; GMail did a pretty good job filtering out the worst of it.  But something changed circa 2017-2018 - I don't know what - and more of it started getting through to my inbox.  I started seeing 50, 100, 200 spam mails a day.

Rather than abandon my address (something I'm still considering), I thought I'd take a crack at implementing my own, more aggressive, filtering logic on top of GMail's.

**GMaul** is that logic.

This is still very-much a pet project, so I'm not going to pretend it's very approachable or well-supported. But you're welcome to try it out...

## Getting Started

* `git clone` this repo
* `cd config`
* `cp gmaul.sample.jsonc gmaul.jsonc`
* Personalize `gmaul.jsonc` to suit your tastes
* `npm run build && npm start`