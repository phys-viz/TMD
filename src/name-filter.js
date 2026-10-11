// Group-name filter. Server-only: this file is never sent to student browsers.
//
// To block another word, add it to one of the lists below (lowercase letters only).
// - anywhere: blocked even inside a longer name ("fuck" also blocks "superfuckers").
//   Use this only for words that never hide inside ordinary words.
// - wholeWord: blocked only as a separate word, plus simple endings (s, es, ed, er, ers, ing),
//   so "ass" blocks "Big Ass" but not "Class Act", and "rape" does not block "Grapes".
// - exact: checked against the name's raw words before any letter substitution (numbers, etc.).

const anywhere = [
  // profanity
  "fuck", "fuk", "fuq", "fck", "fvck", "fcuk", "phuck", "phuk", "shit", "bitch", "biatch", "bastard", "asshole", "arsehole",
  "dumbass", "jackass", "smartass", "dickhead", "motherf", "piss", "wank", "bollock", "douche", "twat",
  // sexual
  "penis", "vagina", "pussy", "dildo", "blowjob", "handjob", "orgasm", "jizz", "testicle", "hentai",
  "porn", "boob", "molest", "masturb", "erection", "clitoris",
  // slurs and hate
  "nigg", "niga", "faggot", "retard", "tranny", "wetback", "beaner", "nazi", "hitler", "kkk"
];

const wholeWord = [
  "ass", "arse", "dick", "cock", "prick", "tit", "cum", "cunt", "horny", "anal", "anus", "rape", "rapist", "sex", "sexy",
  "semen", "nude", "milf", "xxx", "slut", "whore", "hoe", "thot", "pedo", "kys", "stfu", "wtf",
  "fag", "spic", "chink", "kike", "gook", "coon", "dyke", "homo", "lesbo", "jap"
];

const exact = ["69", "420"];

// Common letter swaps; "1" and "|" are tried as both i and l.
const leet = { "0": "o", "3": "e", "4": "a", "@": "a", "5": "s", "$": "s", "7": "t", "8": "b", "9": "g", "!": "i", "+": "t" };

// Each letter may repeat ("shiiit"), but a word's double letters must still be there ("as" is not "ass").
const pattern = word => word.split("").map(ch => `${ch}+`).join("");
const anywherePatterns = anywhere.map(word => new RegExp(pattern(word)));
const wholeWordPatterns = wholeWord.map(word => new RegExp(`^${pattern(word)}(s|es|ed|er|ers|ing)?$`));

function spellings(name) {
  const base = String(name)
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2") // split camelCase: "BigAss" -> "Big Ass"
    .toLowerCase()
    .replace(/[03-9@$!+]/g, ch => leet[ch] || ch);
  return [base.replace(/[1|]/g, "i"), base.replace(/[1|]/g, "l")];
}

// Splits into words, rejoining spaced-out letters ("f u c k", "a.s.s") into one word.
function wordsOf(text) {
  const words = [];
  let letters = "";
  for (const token of text.split(/[^a-z]+/).filter(Boolean)) {
    if (token.length === 1) { letters += token; continue; }
    if (letters) { words.push(letters); letters = ""; }
    words.push(token);
  }
  if (letters) words.push(letters);
  return words;
}

function isBlockedName(name) {
  const raw = String(name).toLowerCase().split(/[^a-z0-9]+/);
  if (raw.some(word => exact.includes(word))) return true;
  return spellings(name).some(text => {
    const squashed = text.replace(/[^a-z]/g, "");
    if (anywherePatterns.some(re => re.test(squashed))) return true;
    return wordsOf(text).some(word => wholeWordPatterns.some(re => re.test(word)));
  });
}

module.exports = { isBlockedName };
