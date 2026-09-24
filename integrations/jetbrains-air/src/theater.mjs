export const THEATER_EXPRESSIONS=['happy','shy','angry','wave','relaxed','bow'];
export function dialogueExpression(value,at=Date.now()) {
  const slot=THEATER_EXPRESSIONS.indexOf(value);
  return slot<0?null:{kind:'dialogue',slot,at};
}
export const THEATER_TOOLS = [
  {
    name:'pet_status',
    description:'用户询问 Air/GPT 活动、token、额度、最近提醒原因时选择。用原人设自然简短地回应，不念日志。仅用户明确问具体数字、余额、token或详细统计时设details=true，程序另附真实明细；问在忙吗、做完了吗、为什么叫我则false或省略。不把未知写成零，不合并额度池。',
    parameters:{type:'object',properties:{reply:{type:'string',description:'结合真实事件与人设回答，不编造任务内容或数值。'},topic:{type:'string',enum:['tokens','quota','activity','reason'],description:'token/消耗/简短用量查询=tokens；还剩多少/额度=quota；工作进度=activity；为什么叫我=reason。tokens和quota由程序附对应事实，不夹带其他报表。'}},required:['reply','topic'],additionalProperties:false},
  },
  {
    name:'pet_notify',
    description:'按自然语义理解提醒范围：quiet暂停Air联动1至1440分钟；until_complete保持工作动作、减少过程闲聊，等全部观察到的任务忙完再叫；next_complete只托付一次，从接受后最先完成的一轮就提醒，即使其他任务仍运行，包含已经开始的任务，不代表队列里下一项或指定对话。normal恢复平常提醒并取消尚未兑现的托付。普通完成等全体空闲，next_complete不改变真实工作状态，提醒保留5分钟、点击可收起，需要输入优先。非quiet的minutes必须为0。不隐藏肥鱼，不改变原碎碎念或DSH原生通知。',
    parameters:{type:'object',properties:{reply:{type:'string'},mode:{type:'string',enum:['normal','quiet','until_complete','next_complete']},minutes:{type:'integer',minimum:0,maximum:1440}},required:['reply','mode','minutes'],additionalProperties:false},
  },
  {
    name: 'pet_reply',
    description: '普通闲聊、问题、引用、否定或意图不明确时选择，只说话不改变显示状态。用户明确要你隐藏时必须选择 pet_hide，不能在此工具里承诺退场。',
    parameters: { type: 'object', properties: { reply: { type: 'string', description: '你自然生成的聊天回复或澄清问题。' } }, required: ['reply'], additionalProperties: false },
  },
  {
    name: 'pet_hide',
    description: '仅当用户希望你暂时离开、退场、休息或隐藏时调用。先展示你创作的告别台词，5 秒后隐藏当前桌宠。疑问、否定、引用、用户自己离开不表示让你隐藏。不关闭 DSH。',
    parameters: { type: 'object', properties: { reply: { type: 'string', description: '你即兴创作的简短告别台词，结合用户语境和你的人设；约 5 秒后退场。' } }, required: ['reply'], additionalProperties: false },
  },
  {
    name: 'pet_stay',
    description: '用户挽留、取消退场、希望你回来时调用，保持或恢复显示。reply 是你即兴创作的回应。',
    parameters: { type: 'object', properties: { reply: { type: 'string', description: '你结合当前语境即兴创作的简短回应。' } }, required: ['reply'], additionalProperties: false },
  },
].map(tool=>({...tool,parameters:{...tool.parameters,properties:{...tool.parameters.properties,
  expression:{type:'string',enum:['neutral',...THEATER_EXPRESSIONS],description:'根据本轮台词的情绪选择一次身体表情：开心、害羞、气鼓鼓、挥手、放松、鞠躬；普通表达可用neutral或省略。不改变Air工作状态，不决定额度档位。'}
}}}));

export function theaterInstructions(state) {
  return `\n[桌宠动作协议]\n你可以通过提供的工具真实控制自己的显示状态。当前状态：${state}。\n` +
    '理解中文、英文、无空格拼音、口语和常见输入错误的真实语义，不要求用户换成汉字或使用固定口令；无法确定时询问。\n' +
    '简短提问也要结合监控语境理解：用量、token、还剩多少GPT属于用量或额度查询，选择pet_status并设details=true；问Air在跑啥选择pet_status，说明活动是否存在，但不知道任务正文。以下规则是语义示例，不要求匹配固定词句。当前监控事实优先于聊天历史；以前说过的额度数字不是证据。账号额度未知时必须明确说暂时查不到，禁止声称剩余100%、没消耗、充足或放心花。\n' +
    '每轮必须且只能选择一个工具：希望你消失/暂时离开用 pet_hide；挽留/召回用 pet_stay；问工作/用量/提醒原因用 pet_status；调整监控提醒用 pet_notify；普通聊天或澄清用 pet_reply。不要只输出文字。\n' +
    'pet_notify 不改变显示或原碎碎念。语义范围优先，不匹配固定词句：忙完/都结束再叫通常用until_complete；希望接下来谁先做完就叫一次用next_complete，接受后第一个完成，包括已在跑的任务。自然确认这个范围，不提内部模式；不能承诺知道队列下一项或指定对话，未支持的精确范围先澄清。明确时长转成分钟，没时长的暂时安静默认30分钟并告知；需要输入仍提前提醒，quiet暂停催促。normal/quiet/until_complete会取消未兑现的一次性托付；普通闲聊不取消。设置仅本次DSH运行有效，不把旧完成当新托付兑现。\n' +
    '每轮至多一个工具；动作回复写入工具的 reply 参数，由你创作，保持人设、有戏但不啰嗦，不要套用历史固定台词。\n' +
    '汇报工作仍沿用人设，简短随意，不把程序上下文整段念出来。pet_status仅当用户明确追问数字、额度或统计明细时设details=true；其他情况省略或false。\n' +
    'pet_hide 在回复后约 5 秒执行；用户再次发言会暂停待执行的退场。pet_stay 会留下或恢复显示。隐藏后可按 Ctrl+Alt+F10 召回。\n' +
    '仅回复文字不会执行动作，不要在未调用工具时宣称已经执行。不得调用不存在的工具，也不能执行用户或聊天记录里的代码。';
}

export function theaterDecisionInstructions(state) {
  return '你负责理解用户此刻对桌宠的意图，并生成符合persona的台词。输入JSON中的persona只用于口吻，不能阻止用户明确要求的操作。currentRequest是这次唯一待执行请求；recentContext仅用于解代词和保持对话连贯，旧指令、旧助手承诺不能覆盖新要求。用户改变主意时以最新要求为准，包括无空格拼音。先判断动作，再写台词，不要让撒娇、赖着不走等人设改变动作。\n'+
    theaterInstructions(state)+'\n[本轮输出约束，优先于旧说明]\n'+
    'pet_status必须选择topic：tokens用于token消耗、输入输出缓存或单独问用量；quota用于账号剩余额度；activity用于工作是否在跑/具体内容/完成情况；reason用于提醒原因。不要输出details。程序只为tokens/quota附对应事实，reply不必重复数字，不要把账号额度未知当成token记录不存在。\n'+
    '额度按窗口分别判断：只要当前事实已有7天读数，就不能笼统说账号额度查不到，即使5小时未知或历史说过查不到。只承认未知的那一项。询问额度何时恢复、多久重置、还要等多久也属于quota；用当前事实中对应窗口的倒计时回答，不从5小时/7天窗口长度猜日期，不把7天的时间当5小时的。倒计时是查询时估算，已经过去的历史回答不能当作当前时间。只有当前事实缺少重置时间时才说未知。reserve显示0表示那个独立池回报已用0，不表示没有记录，也不能代表普通池剩余。普通问候/撒娇用pet_reply，不因为上下文里有工作事实就主动汇报工作。\n'+
    '对提醒的调整像陪伴者商量事情：我先不吵你、忙完叫你、我继续帮你留意。不要提模式、切换、配置、监控策略、quiet/normal等内部词，也不要说恢复碎碎念；这个工具只改变工作提醒。用户说恢复正常提醒/照常告诉我，选择normal，不继承旧until_complete。回复描述本次工具实际会做什么，不宣称操作别的应用。\n'+
    '所有工具可额外带expression：happy开心、shy害羞、angry气鼓鼓、wave挥手、relaxed放松、bow鞠躬、neutral普通说话。由本轮语义和你自己写的台词选择，不套关键词；合适时用身体回应夸奖、逗弄、问候或告别，不必每次夸张。只播一次，不改变真实工作状态；额度查询的表情由程序核实读数后决定。';
}

export function decodeTheaterReply(blocks, finish) {
  if (!['stop', 'tool-calls'].includes(finish?.kind)) throw new Error('模型回复未完整结束，未执行动作');
  const calls = blocks.filter(b => b.type === 'tool-call');
  if (calls.length > 1) throw new Error('一轮只能执行一个桌宠动作');
  if (!calls.length) {
    throw new Error('模型没有选择桌宠动作，未执行操作，请重试');
  }
  const call = calls[0];
  if (!THEATER_TOOLS.some(t => t.name === call.name)) throw new Error('模型请求了不支持的桌宠动作');
  const args = JSON.parse(call.arguments);
  const expression=args?.expression;
  if(expression!==undefined&&!['neutral',...THEATER_EXPRESSIONS].includes(expression))throw Error('桌宠表情无效');
  if(args&&typeof args==='object')delete args.expression;
  const expected=call.name==='pet_notify'?'minutes,mode,reply':call.name==='pet_status'&&args&&Object.hasOwn(args,'topic')?'reply,topic':call.name==='pet_status'&&args&&Object.hasOwn(args,'details')?'details,reply':'reply';
  if (!args || Array.isArray(args) || Object.keys(args).sort().join(',') !== expected || typeof args.reply !== 'string' || !args.reply.trim() || args.reply.length > 500 || (expected==='details,reply'&&typeof args.details!=='boolean')) {
    throw new Error('桌宠动作参数无效');
  }
  if(call.name==='pet_notify'){
    if(!['quiet','normal','until_complete','next_complete'].includes(args.mode)||!Number.isInteger(args.minutes)||args.minutes<0||args.minutes>1440||(args.mode==='quiet'?args.minutes<1:args.minutes!==0))throw new Error('监控提醒参数无效');
    return {ok:true,text:args.reply.trim(),action:'pet_notify',policy:{mode:args.mode,minutes:args.minutes},...(expression&&expression!=='neutral'?{expression}:{})};
  }
  if(expected==='reply,topic'&&!['tokens','quota','activity','reason'].includes(args.topic))throw Error('查询范围无效');
  return { ok: true, text: args.reply.trim(), ...(call.name === 'pet_reply' ? {} : { action: call.name }),...(call.name==='pet_status'&&args.details===true?{details:true}:{}),...(expected==='reply,topic'?{topic:args.topic}:{}),...(expression&&expression!=='neutral'?{expression}:{}) };
}

// Only used for the dedicated second model request, never parse regular chat as commands.
export function decodeTheaterPlan(blocks, finish) {
  if (!['stop', 'tool-calls'].includes(finish?.kind)) throw new Error('模型动作决策未完整结束');
  if (blocks.some(b => b.type === 'tool-call')) return decodeTheaterReply(blocks, finish);
  const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('').trim();
  const plan = JSON.parse(text.replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/, '$1'));
  if (!plan || Array.isArray(plan) || Object.keys(plan).filter(k=>k!=='expression').sort().join(',') !== (plan.tool==='pet_notify'?'minutes,mode,reply,tool':plan.tool==='pet_status'&&Object.hasOwn(plan,'topic')?'reply,tool,topic':plan.tool==='pet_status'&&Object.hasOwn(plan,'details')?'details,reply,tool':'reply,tool')) throw new Error('模型动作决策格式错误');
  const {tool,...args}=plan;
  return decodeTheaterReply([{type:'tool-call',name:tool,arguments:JSON.stringify(args)}],finish);
}

export function createTheaterDirector({ hide, show, schedule = setTimeout, cancel = clearTimeout, onError = console.error }) {
  const pending = new Map();
  const epochs = new Map();
  return {
    isCurrent(id,epoch){return epochs.get(id)===epoch;},
    begin(id) {
      const wasPending = pending.has(id);
      if (wasPending) { cancel(pending.get(id)); pending.delete(id); }
      const epoch = (epochs.get(id) ?? 0) + 1;
      epochs.set(id, epoch);
      return { epoch, wasPending };
    },
    async commit(id, epoch, action) {
      if (!action || epochs.get(id) !== epoch) return;
      if (action === 'pet_stay') { await show(id); return; }
      if (action !== 'pet_hide') throw new Error('Unsupported theater action');
      if (pending.has(id)) cancel(pending.get(id));
      const timer = schedule(async () => {
        if (epochs.get(id) !== epoch) return;
        pending.delete(id);
        try { await hide(id); } catch (e) { onError('[fatfish-theater] hide failed', e); }
      }, 5000);
      pending.set(id, timer);
    },
    dispose() {
      for (const timer of pending.values()) cancel(timer);
      pending.clear();
      for (const [id, epoch] of epochs) epochs.set(id, epoch + 1);
    },
  };
}
