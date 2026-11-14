// 音频层 · 朗读（Web Speech API）。优先选择英文和中文语音；没有对应语音时按 lang 交给系统处理。
export class Speech {
  constructor() {
    this.synth = window.speechSynthesis || null;
    this.voices = [];
    if (this.synth) {
      const load = () => { this.voices = this.synth.getVoices(); };
      load();
      this.synth.addEventListener?.('voiceschanged', load);
    }
  }
  get available() { return !!this.synth; }

  pick(lang) {
    const v = this.voices;
    if (!v.length) return null;
    if (lang === 'en') {
      const pref = ['Samantha', 'Google US English', 'Microsoft Aria', 'Microsoft Jenny', 'Karen', 'Daniel'];
      return pref.map(n => v.find(x => x.name.includes(n) && x.lang.startsWith('en'))).find(Boolean)
        || v.find(x => x.lang === 'en-US') || v.find(x => x.lang.startsWith('en'));
    }
    const pref = ['Tingting', 'Ting-Ting', 'Google 普通话', 'Microsoft Xiaoxiao', 'Microsoft Huihui', 'Meijia'];
    return pref.map(n => v.find(x => x.name.includes(n))).find(Boolean)
      || v.find(x => /zh[-_]CN/i.test(x.lang)) || v.find(x => x.lang.startsWith('zh'));
  }

  /** parts: [{ text, lang: 'en'|'zh' }]，返回在全部读完（或超时）后 resolve 的 Promise。 */
  say(parts, timeoutMs = 7000) {
    if (!this.synth || !parts.length) return Promise.resolve();
    this.synth.cancel();
    return new Promise((resolve) => {
      let left = parts.length, done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      setTimeout(finish, timeoutMs);
      for (const p of parts) {
        const u = new SpeechSynthesisUtterance(p.text);
        u.lang = p.lang === 'en' ? 'en-US' : 'zh-CN';
        const voice = this.pick(p.lang); if (voice) u.voice = voice;
        u.rate = p.lang === 'en' ? 0.85 : 0.9; u.pitch = 1.15; u.volume = 1;
        u.onend = u.onerror = () => { if (--left <= 0) finish(); };
        this.synth.speak(u);
      }
    });
  }

  /** 按语言设置生成卡片的朗读内容 */
  cardParts(card, lang) {
    if (card.id === 'upload') {
      return lang === 'en' ? [{ text: 'Wow! It is your picture!', lang: 'en' }]
        : lang === 'zh' ? [{ text: '哇！原来是你画的画！', lang: 'zh' }]
          : [{ text: '哇！原来是你画的画！', lang: 'zh' }, { text: 'Wow!', lang: 'en' }];
    }
    const en = [{ text: `${card.letter}.`, lang: 'en' }, { text: `${card.word}!`, lang: 'en' }];
    const zh = [{ text: card.zh, lang: 'zh' }];
    if (lang === 'en') return en;
    if (lang === 'zh') return [{ text: `${card.letter}，${card.zh}`, lang: 'zh' }];
    return [...en, ...zh];
  }

  cancel() { this.synth?.cancel(); }
}
