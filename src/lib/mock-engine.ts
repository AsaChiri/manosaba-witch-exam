/*
 * MockEngine — a deterministic stand-in for @manosaba/engine so the whole
 * examination is drivable today. ~9 questions across the coping (観測) →
 * origin (深層) → picks (照合) phases, resolving deterministically to one of
 * the authored fixture cells. Swap for the real scorer via engine.ts.
 */
import type {
  CreateExam,
  ExamContent,
  ExamProgress,
  ExamQuestion,
  ExamResult,
  ExamSession,
  ExamSnapshot,
  ExamPhase,
} from './engine-api'
import type { Locale } from '../i18n/config'

interface Localized {
  prompt: string
  options: [string, string, string, string]
}
interface MockQuestion {
  id: string
  phase: ExamPhase
  weight: number
  text: Record<Locale, Localized>
}

const QUESTIONS: MockQuestion[] = [
  {
    id: 'q1',
    phase: 'observe',
    weight: 1,
    text: {
      'zh-CN': {
        prompt: '你和一个亲近的人之间，刚裂开一道缝。你真正会做的，是——',
        options: [
          '把对方拉近，趁裂缝还小，当场解决。',
          '沉默下来，拉开距离，让它自己冷却。',
          '把问题当面说破，哪怕会刺人。',
          '像什么都没发生一样，照常过。',
        ],
      },
      en: {
        prompt: 'Something between you and someone close has just cracked. The move that is truly yours:',
        options: [
          'Pull them closer and settle it now, before the gap can widen.',
          'Go quiet, keep your distance, and let it cool on its own.',
          'Name the fault out loud, even if it stings.',
          'Carry on as if nothing has happened.',
        ],
      },
      ja: {
        prompt: '近しい相手とのあいだに、たった今ひびが入った。あなたが本当に取る一手は——',
        options: [
          '相手を引き寄せ、隙間が広がる前に、その場で片づける。',
          '黙って距離を取り、ひとりでに冷めるのを待つ。',
          'たとえ相手を刺しても、非をはっきり口にする。',
          '何もなかったように、いつも通りに過ごす。',
        ],
      },
      'zh-TW': {
        prompt: '你和一個親近的人之間，剛裂開一道縫。你真正會做的，是——',
        options: [
          '把對方拉近，趁裂縫還小，當場解決。',
          '沉默下來，拉開距離，讓它自己冷卻。',
          '把問題當面說破，哪怕會刺人。',
          '像什麼都沒發生一樣，照常過。',
        ],
      },
    },
  },
  {
    id: 'q2',
    phase: 'observe',
    weight: 1,
    text: {
      'zh-CN': {
        prompt: '满屋子的陌生人，都转过来看你。你心里——',
        options: ['去够他们的目光，让他们喜欢你。', '先看清出口，掂量周围的风险。', '缩起来，等着被人忽略。', '什么都没动，毫无波澜。'],
      },
      en: {
        prompt: 'A room full of strangers turns to look at you. Inside, you—',
        options: ['reach for their eyes, and make them like you.', 'map the exits and weigh the risks.', 'shrink, and wait to be overlooked.', 'feel nothing stir at all.'],
      },
      ja: {
        prompt: '見知らぬ者ばかりの部屋が、いっせいにあなたを見る。あなたの内では——',
        options: ['その視線を求め、好かれようとする。', '出口を確かめ、危うさを測る。', '身を縮め、見過ごされるのを待つ。', '何ひとつ、揺れない。'],
      },
      'zh-TW': {
        prompt: '滿屋子的陌生人，都轉過來看你。你心裡——',
        options: ['去搆他們的目光，讓他們喜歡你。', '先看清出口，掂量周圍的風險。', '縮起來，等著被人忽略。', '什麼都沒動，毫無波瀾。'],
      },
    },
  },
  {
    id: 'q3',
    phase: 'observe',
    weight: 1,
    text: {
      'zh-CN': {
        prompt: '一件事脱出了你的掌控。你的第一反应是——',
        options: ['把还抓得住的每一根线，都收紧。', '做最坏的打算，盯紧它。', '任它去，不再攥着。', '查清是谁的错。'],
      },
      en: {
        prompt: 'A plan slips out of your hands. Your first reflex is to—',
        options: ['tighten every thread you can still hold.', 'brace for the worst and keep watch for it.', 'let it drift, and stop holding on.', 'find out whose fault it is.'],
      },
      ja: {
        prompt: 'ものごとが手を離れていく。あなたの最初の反射は——',
        options: ['まだ握れる糸を、一本残らず締め直す。', '最悪に備え、目を離さず見張る。', '流れるにまかせ、握るのをやめる。', '誰の落ち度かを突き止める。'],
      },
      'zh-TW': {
        prompt: '一件事脫出了你的掌控。你的第一反應是——',
        options: ['把還抓得住的每一根線，都收緊。', '做最壞的打算，盯緊它。', '任它去，不再攥著。', '查清是誰的錯。'],
      },
    },
  },
  {
    id: 'q4',
    phase: 'observe',
    weight: 1,
    text: {
      'zh-CN': {
        prompt: '你留住的人，你靠的是——',
        options: ['从不让他们离开你的视线。', '做那个他们离不开的人。', '什么都不要，就谁也不欠。', '留一扇门，好让自己先走。'],
      },
      en: {
        prompt: 'The people you keep — you keep them by—',
        options: ['never letting them out of your sight.', 'being the one they cannot do without.', 'asking for nothing, so nothing is owed.', 'keeping a door open to leave first.'],
      },
      ja: {
        prompt: 'あなたがつなぎとめる相手を、あなたは——',
        options: ['片時も、視界から出さないことで。', '相手が欠かせない、その一人になることで。', '何も求めず、貸し借りを作らないことで。', '先に去れるよう、扉を一つ開けておくことで。'],
      },
      'zh-TW': {
        prompt: '你留住的人，你靠的是——',
        options: ['從不讓他們離開你的視線。', '做那個他們離不開的人。', '什麼都不要，就誰也不欠。', '留一扇門，好讓自己先走。'],
      },
    },
  },
  {
    id: 'q5',
    phase: 'deep',
    weight: 1,
    text: {
      'zh-CN': {
        prompt: '说实话，你最古老的那点恐惧是——',
        options: ['你抓住的人，最后都会离开。', '若他们真看清你，就会转身走开。', '平静是假的，灾祸其实已在路上。', '别人本就有的，你从来没被给过。'],
      },
      en: {
        prompt: 'The oldest fear, if you are honest, is that—',
        options: ['everyone you hold will leave in the end.', 'if they truly saw you, they would turn away.', 'the calm is a lie, and disaster is already coming.', 'you were never given what others simply had.'],
      },
      ja: {
        prompt: '正直に言えば、あなたの最も古い恐れは——',
        options: ['つなぎとめた相手は、最後にはみな去る。', '本当のあなたを見れば、みな背を向ける。', '静けさは嘘で、災いはもう来ている。', '他の者が当たり前に持つものを、あなたは与えられなかった。'],
      },
      'zh-TW': {
        prompt: '說實話，你最古老的那點恐懼是——',
        options: ['你抓住的人，最後都會離開。', '若他們真看清你，就會轉身走開。', '平靜是假的，災禍其實已在路上。', '別人本就有的，你從來沒被給過。'],
      },
    },
  },
  {
    id: 'q6',
    phase: 'deep',
    weight: 1,
    text: {
      'zh-CN': {
        prompt: '童年里，真正刻进去的那一课是——',
        options: ['安稳，可以毫无预兆地消失。', '每一点温暖，都得自己挣来。', '房间里出问题的，是你。', '要紧的人，最后总会走。'],
      },
      en: {
        prompt: 'The lesson from childhood that stuck was—',
        options: ['safety can vanish without a warning.', 'you had to earn every scrap of warmth.', 'you were the problem in the room.', 'the ones who mattered always went away.'],
      },
      ja: {
        prompt: '幼い日に、深く刻まれた教えは——',
        options: ['安らぎは、前触れもなく消える。', 'ひとかけらの温もりも、自分で稼ぐしかない。', 'その場で問題だったのは、あなただった。', '大切な人は、いつも去っていった。'],
      },
      'zh-TW': {
        prompt: '童年裡，真正刻進去的那一課是——',
        options: ['安穩，可以毫無預兆地消失。', '每一點溫暖，都得自己掙來。', '房間裡出問題的，是你。', '要緊的人，最後總會走。'],
      },
    },
  },
  {
    id: 'q7',
    phase: 'deep',
    weight: 1,
    text: {
      'zh-CN': {
        prompt: '夜深时，你反复回到的那个念头：',
        options: ['盯着，否则它会趁你不备。', '抓紧，否则你会被丢下。', '藏好，否则他们会看见你哪里不对。', '算清，否则你会没有份。'],
      },
      en: {
        prompt: 'The thought you return to, late at night:',
        options: ['watch, or it will catch you off guard.', 'hold on, or you will be left.', 'hide it, or they will see what is wrong with you.', 'count it, or you will go without.'],
      },
      ja: {
        prompt: '夜更けに、あなたが何度も戻る思い：',
        options: ['見張れ。さもなくば不意を突かれる。', 'つなぎとめろ。さもなくば置いて行かれる。', '隠せ。さもなくば、どこが欠けているか見られる。', '数えておけ。さもなくば、あなたの分はない。'],
      },
      'zh-TW': {
        prompt: '夜深時，你反覆回到的那個念頭：',
        options: ['盯著，否則它會趁你不備。', '抓緊，否則你會被丟下。', '藏好，否則他們會看見你哪裡不對。', '算清，否則你會沒有份。'],
      },
    },
  },
  {
    id: 'q8',
    phase: 'match',
    weight: 3,
    text: {
      'zh-CN': {
        prompt: '若有一种力量，从这一切里长出来，它会让你——',
        options: ['把你输不起的那个人，永远留在手边。', '同时感知墙内每一个活着的生命。', '把被夺走的，重新夺回来。', '不让任何人看见你的缺口。'],
      },
      en: {
        prompt: 'If a power grew from all of this, it would let you—',
        options: ['keep the one you cannot lose always within reach.', 'feel every living thing inside the walls at once.', 'take back what was taken from you.', 'let no one see the flaw in you.'],
      },
      ja: {
        prompt: 'もしこのすべてから、一つの力が育つなら、それはあなたに——',
        options: ['失えない相手を、いつも手の届くところに置かせる。', '壁の中の生者すべてを、一度に感じさせる。', '奪われたものを、奪い返させる。', 'あなたの欠けを、誰にも見せない。'],
      },
      'zh-TW': {
        prompt: '若有一種力量，從這一切裡長出來，它會讓你——',
        options: ['把你輸不起的那個人，永遠留在手邊。', '同時感知牆內每一個活著的生命。', '把被奪走的，重新奪回來。', '不讓任何人看見你的缺口。'],
      },
    },
  },
  {
    id: 'q9',
    phase: 'match',
    weight: 3,
    text: {
      'zh-CN': {
        prompt: '而那力量里藏着的失手——它唯一做不到的，是——',
        options: ['留住一颗已经决定要走的心。', '看见那从一开始就不曾活着的危险。', '填上很久以前就空了的地方。', '抹去那件你笃定是你之过的事。'],
      },
      en: {
        prompt: 'And the miss hidden inside that power — the one thing it can never do—',
        options: ['hold a heart that has already decided to leave.', 'see the danger that was never alive to begin with.', 'fill what was hollow long ago.', 'undo the fault you were sure was yours.'],
      },
      ja: {
        prompt: 'そしてその力に潜む取りこぼし——それだけは、決してできない——',
        options: ['もう去ると決めた心を、つなぎとめること。', 'はじめから生きてなどいない危険を、見ること。', 'とうに空いた場所を、満たすこと。', 'あなたの過ちだと信じたそれを、なかったことにすること。'],
      },
      'zh-TW': {
        prompt: '而那力量裡藏著的失手——它唯一做不到的，是——',
        options: ['留住一顆已經決定要走的心。', '看見那從一開始就不曾活著的危險。', '填上很久以前就空了的地方。', '抹去那件你篤定是你之過的事。'],
      },
    },
  },
]

class MockSession implements ExamSession {
  private answers: string[] = []
  private witchName: string | undefined
  constructor(private content: ExamContent) {}

  private questionAt(i: number): MockQuestion | undefined {
    return QUESTIONS[i]
  }

  current(): ExamQuestion | null {
    const i = this.answers.length
    const q = this.questionAt(i)
    if (!q) return null
    const loc = q.text[this.content.locale] ?? q.text.en
    return {
      id: q.id,
      phase: q.phase,
      prompt: loc.prompt,
      options: loc.options.map((label, idx) => ({ id: `${q.id}:${idx}`, label })),
      canGoBack: i > 0,
    }
  }

  answer(optionId: string): void {
    const q = this.questionAt(this.answers.length)
    if (!q) return
    if (!optionId.startsWith(`${q.id}:`)) return
    this.answers.push(optionId)
  }

  back(): void {
    if (this.answers.length > 0) this.answers.pop()
  }

  canGoBack(): boolean {
    return this.answers.length > 0 && this.answers.length < QUESTIONS.length
  }

  progress(): ExamProgress {
    const answered = this.answers.length
    const idx = Math.min(answered, QUESTIONS.length - 1)
    const phase = QUESTIONS[idx]?.phase ?? 'match'
    return {
      phase,
      answered,
      ordinal: Math.min(answered + 1, QUESTIONS.length),
      resonance: Math.min(1, answered / QUESTIONS.length),
    }
  }

  isDone(): boolean {
    return this.answers.length >= QUESTIONS.length
  }

  setWitchName(name: string | undefined): void {
    this.witchName = name && name.length ? name : undefined
  }

  private optionIndex(optionId: string): number {
    const n = Number(optionId.split(':')[1])
    return Number.isFinite(n) ? n : 0
  }

  result(): ExamResult | null {
    if (!this.isDone()) return null
    const cells = this.content.cells
    if (cells.length === 0) return null
    let sum = 0
    this.answers.forEach((a, i) => {
      const weight = QUESTIONS[i]?.weight ?? 1
      sum += this.optionIndex(a) * weight
    })
    const n = cells.length
    const chosen = cells[((sum % n) + n) % n]
    return {
      tag: chosen.tag,
      cell: chosen.cell,
      origin: chosen.origin,
      coping: chosen.coping,
      witchName: this.witchName,
      quizVersion: this.content.quizVersion,
    }
  }

  snapshot(): ExamSnapshot {
    return { answers: [...this.answers], witchName: this.witchName }
  }

  restore(snapshot: ExamSnapshot): void {
    // Keep only answers that correspond to real questions, in order.
    this.answers = snapshot.answers
      .slice(0, QUESTIONS.length)
      .filter((a, i) => a.startsWith(`${QUESTIONS[i]?.id}:`))
    this.witchName = snapshot.witchName
  }
}

export const createExam: CreateExam = (content) => new MockSession(content)

/** Exposed for the resonance readout / dev tooling. */
export const MOCK_QUESTION_COUNT = QUESTIONS.length
