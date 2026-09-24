import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const config = window.DAILYPLAN_CONFIG || {};
const supabaseUrl = (config.SUPABASE_URL || "").trim();
const supabaseKey = (config.SUPABASE_ANON_KEY || "").trim();

const configWarning = document.querySelector("#config-warning");
const loginView = document.querySelector("#login-view");
const planView = document.querySelector("#plan-view");
const loginForm = document.querySelector("#login-form");
const loginError = document.querySelector("#login-error");
const planError = document.querySelector("#plan-error");
const userBar = document.querySelector("#user-bar");
const userEmail = document.querySelector("#user-email");
const logoutButton = document.querySelector("#logout");
const dateInput = document.querySelector("#plan-date");
const dateLabel = document.querySelector("#date-label");
const liveStatus = document.querySelector("#live-status");
const messageNotice = document.querySelector("#message-notice");
const addForm = document.querySelector("#add-form");
const newTitle = document.querySelector("#new-title");
const mineList = document.querySelector("#mine-list");
const sharedList = document.querySelector("#shared-list");
const mineEmpty = document.querySelector("#mine-empty");
const sharedEmpty = document.querySelector("#shared-empty");
const messageForm = document.querySelector("#message-form");
const messageBody = document.querySelector("#message-body");
const messageList = document.querySelector("#message-list");
const messageEmpty = document.querySelector("#message-empty");
const messageContext = document.querySelector("#message-context");
const messageContextLabel = document.querySelector("#message-context-label");
const messageContextText = document.querySelector("#message-context-text");
const clearMessageContextButton = document.querySelector("#clear-message-context");
const dailyTabPanel = document.querySelector("#daily-tab-panel");
const sleepTabPanel = document.querySelector("#sleep-tab-panel");
const sleepDateLabel = document.querySelector("#sleep-date-label");
const sleepError = document.querySelector("#sleep-error");
const recordWakeButton = document.querySelector("#record-wake");
const recordBedtimeButton = document.querySelector("#record-bedtime");
const myWakeTime = document.querySelector("#my-wake-time");
const myBedtime = document.querySelector("#my-bedtime");
const mySleepDuration = document.querySelector("#my-sleep-duration");
const partnerWakeTime = document.querySelector("#partner-wake-time");
const partnerBedtime = document.querySelector("#partner-bedtime");
const partnerSleepDuration = document.querySelector("#partner-sleep-duration");

let supabase = null;
let currentUser = null;
let channel = null;
let loadToken = 0;
let replyTarget = null;
let quotedPlan = null;
let sleepRows = [];
let loadedMessages = [];

function show(el, visible) {
  el.hidden = !visible;
}

function setError(el, message) {
  el.textContent = message || "";
}

function todayISO() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function shiftISO(iso, days) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  const nextMonth = String(date.getMonth() + 1).padStart(2, "0");
  const nextDay = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${nextMonth}-${nextDay}`;
}

function formatDate(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(new Date(year, month - 1, day));
}

function friendlyError(error) {
  const message = error?.message || "操作失败";
  if (/invalid login credentials/i.test(message)) return "邮箱或密码不正确";
  if (/email not confirmed/i.test(message)) return "邮箱还没确认，请在 Supabase 里确认该用户";
  return message;
}

function sortPlans(items) {
  return [...items].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return a.title.localeCompare(b.title, "zh");
  });
}

function setMessageContext({ reply = null, plan = null } = {}) {
  replyTarget = reply;
  quotedPlan = plan;
  const target = reply || plan;
  show(messageContext, Boolean(target));
  if (!target) {
    messageContextLabel.textContent = "";
    messageContextText.textContent = "";
    return;
  }
  messageContextLabel.textContent = reply ? "正在回复" : "正在引用共享任务";
  messageContextText.textContent = reply ? reply.body : plan.title;
  messageBody.focus();
}

function lastSeenStorageKey() {
  return currentUser ? `dailyplan:msg-seen:${currentUser.id}` : "";
}

function getMessagesLastSeen() {
  const key = lastSeenStorageKey();
  return key ? localStorage.getItem(key) || "" : "";
}

function setMessagesLastSeen(iso) {
  const key = lastSeenStorageKey();
  if (key && iso) localStorage.setItem(key, iso);
}

function partnerMessages(items = loadedMessages) {
  if (!currentUser) return [];
  return items.filter((item) => item.user_id !== currentUser.id);
}

function updateMessageNotice(items = loadedMessages) {
  if (!currentUser || !messageNotice) return;
  const lastSeen = getMessagesLastSeen();
  const unread = partnerMessages(items).filter(
    (item) => !lastSeen || item.created_at > lastSeen
  );
  if (unread.length === 0) {
    show(messageNotice, false);
    messageNotice.textContent = "对方有新留言";
    return;
  }
  messageNotice.textContent =
    unread.length === 1 ? "对方有新留言" : `对方有 ${unread.length} 条新留言`;
  show(messageNotice, true);
}

function markMessagesSeen(items = loadedMessages) {
  if (!currentUser) return;
  const partner = partnerMessages(items);
  if (partner.length > 0) {
    const newest = partner.reduce((latest, item) =>
      item.created_at > latest ? item.created_at : latest
    , partner[0].created_at);
    setMessagesLastSeen(newest);
  } else {
    setMessagesLastSeen(new Date().toISOString());
  }
  show(messageNotice, false);
}

function jumpToMessageBoard() {
  switchTab("daily");
  const board = document.querySelector(".message-board");
  board?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function watchMessageBoardVisibility() {
  const board = document.querySelector(".message-board");
  if (!board || typeof IntersectionObserver !== "function") return;

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting || !currentUser) continue;
        // 留言板进入可视区域后才记为已读，避免 Tab/误触输入框清掉提醒。
        markMessagesSeen();
      }
    },
    { threshold: 0.35 }
  );
  observer.observe(board);
}

function formatClock(value) {
  if (!value) return "未记录";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function sleepDuration(bedtime, wakeTime) {
  if (!bedtime || !wakeTime) return "暂无法计算";
  const milliseconds = new Date(wakeTime) - new Date(bedtime);
  if (milliseconds <= 0 || milliseconds > 24 * 60 * 60 * 1000) return "时间记录有误";
  const minutes = Math.round(milliseconds / 60000);
  const hoursPart = Math.floor(minutes / 60);
  const minutesPart = minutes % 60;
  return `${hoursPart} 小时 ${minutesPart} 分钟`;
}

function switchTab(name) {
  const isDaily = name === "daily";
  show(dailyTabPanel, isDaily);
  show(sleepTabPanel, !isDaily);
  for (const button of document.querySelectorAll(".page-tab")) {
    button.classList.toggle("is-active", button.dataset.tab === name);
    button.setAttribute("aria-selected", String(button.dataset.tab === name));
  }
  if (!isDaily) loadSleepRecords();
}

function renderList(list, emptyEl, items, { owned }) {
  list.replaceChildren();
  show(emptyEl, items.length === 0);
  for (const item of items) {
    const li = document.createElement("li");
    li.className = item.done ? "plan-item is-done" : "plan-item";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = item.done;
    checkbox.setAttribute("aria-label", item.done ? "标为未完成" : "标为完成");
    checkbox.addEventListener("change", () => toggleDone(item));

    const title = document.createElement("p");
    title.className = "plan-title";
    title.textContent = item.title;
    if (owned && item.shared) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "已共享";
      title.append(badge);
    }

    li.append(checkbox, title);

    if (owned) {
      const actions = document.createElement("div");
      actions.className = "row-actions";

      const shareButton = document.createElement("button");
      shareButton.type = "button";
      shareButton.className = "ghost";
      shareButton.textContent = item.shared ? "取消共享" : "共享";
      shareButton.addEventListener("click", () => toggleShared(item));

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "ghost danger";
      deleteButton.textContent = "删除";
      deleteButton.addEventListener("click", () => removePlan(item));

      actions.append(shareButton, deleteButton);
      li.append(actions);
    } else {
      const actions = document.createElement("div");
      actions.className = "row-actions";

      const quoteButton = document.createElement("button");
      quoteButton.type = "button";
      quoteButton.className = "ghost quote-plan";
      quoteButton.textContent = "引用留言";
      quoteButton.addEventListener("click", () => setMessageContext({ plan: item }));

      actions.append(quoteButton);
      li.append(actions);
    }

    list.append(li);
  }
}

function formatMessageTime(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function renderMessages(items) {
  messageList.replaceChildren();
  show(messageEmpty, items.length === 0);
  const byId = new Map(items.map((item) => [item.id, item]));

  for (const item of items) {
    const owned = item.user_id === currentUser.id;
    const li = document.createElement("li");
    li.className = `message-item ${owned ? "message-mine" : "message-partner"}`;

    const meta = document.createElement("div");
    meta.className = "message-meta";
    const author = document.createElement("strong");
    author.textContent = owned ? "我" : "对方";
    const time = document.createElement("time");
    time.dateTime = item.created_at;
    time.textContent = formatMessageTime(item.created_at);
    meta.append(author, time);

    const bubble = document.createElement("div");
    bubble.className = "message-bubble";

    const replied = item.reply_to_id ? byId.get(item.reply_to_id) : null;
    if (replied) {
      const quote = document.createElement("blockquote");
      quote.textContent = `${replied.user_id === currentUser.id ? "我" : "对方"}：${replied.body}`;
      bubble.append(quote);
    }

    if (item.quoted_plan_title) {
      const planQuote = document.createElement("div");
      planQuote.className = "message-plan-quote";
      planQuote.textContent = `共享任务：${item.quoted_plan_title}`;
      bubble.append(planQuote);
    }

    const body = document.createElement("p");
    body.textContent = item.body;
    bubble.append(body);

    const actions = document.createElement("div");
    actions.className = "message-actions";
    if (!owned) {
      const replyButton = document.createElement("button");
      replyButton.type = "button";
      replyButton.className = "ghost";
      replyButton.textContent = "回复";
      replyButton.addEventListener("click", () => setMessageContext({ reply: item }));
      actions.append(replyButton);
    }
    if (owned) {
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "ghost danger";
      deleteButton.textContent = "删除";
      deleteButton.addEventListener("click", () => removeMessage(item));
      actions.append(deleteButton);
    }

    li.append(meta, bubble);
    if (actions.childElementCount) li.append(actions);
    messageList.append(li);
  }
}

function showPlanner(user) {
  currentUser = user;
  show(configWarning, false);
  show(loginView, false);
  show(planView, true);
  show(userBar, true);
  userEmail.textContent = user.email || "已登录";
  if (!dateInput.value) dateInput.value = todayISO();
  dateLabel.textContent = formatDate(dateInput.value);
  subscribe();
  loadPlans();
  loadMessages();
  loadSleepRecords();
}

function showLogin() {
  currentUser = null;
  loadedMessages = [];
  show(planView, false);
  show(userBar, false);
  show(loginView, true);
  show(messageNotice, false);
  if (channel && supabase) {
    supabase.removeChannel(channel);
    channel = null;
  }
}

async function loadPlans() {
  if (!supabase || !currentUser) return;
  const token = ++loadToken;
  const planDate = dateInput.value;
  dateLabel.textContent = formatDate(planDate);
  setError(planError, "");

  const { data, error } = await supabase
    .from("plans")
    .select("id, user_id, plan_date, title, done, shared, updated_at")
    .eq("plan_date", planDate);

  if (token !== loadToken) return;
  if (error) {
    setError(planError, friendlyError(error));
    return;
  }

  const rows = data || [];
  const mine = sortPlans(rows.filter((row) => row.user_id === currentUser.id));
  const shared = sortPlans(
    rows.filter((row) => row.shared && row.user_id !== currentUser.id)
  );
  renderList(mineList, mineEmpty, mine, { owned: true });
  renderList(sharedList, sharedEmpty, shared, { owned: false });
}

async function loadMessages() {
  if (!supabase || !currentUser) return;
  const planDate = dateInput.value;
  const { data, error } = await supabase
    .from("messages")
    .select("id, user_id, message_date, body, reply_to_id, quoted_plan_id, quoted_plan_title, created_at")
    .eq("message_date", planDate)
    .order("created_at", { ascending: false });

  if (error) {
    setError(planError, friendlyError(error));
    return;
  }
  loadedMessages = data || [];
  renderMessages(loadedMessages);
  updateMessageNotice(loadedMessages);
}

function renderSleepPerson({ todayRow, previousRow, wakeEl, bedtimeEl, durationEl }) {
  wakeEl.textContent = formatClock(todayRow?.wake_at);
  bedtimeEl.textContent = formatClock(todayRow?.bedtime_at);
  durationEl.textContent = sleepDuration(previousRow?.bedtime_at, todayRow?.wake_at);
}

async function loadSleepRecords() {
  if (!supabase || !currentUser) return;
  const today = todayISO();
  const previousDate = shiftISO(today, -1);
  sleepDateLabel.textContent = formatDate(today);
  setError(sleepError, "");

  const { data, error } = await supabase
    .from("sleep_records")
    .select("id, user_id, record_date, wake_at, bedtime_at, updated_at")
    .gte("record_date", previousDate)
    .lte("record_date", today);

  if (error) {
    setError(sleepError, friendlyError(error));
    return;
  }

  sleepRows = data || [];
  const partnerId = sleepRows.find((row) => row.user_id !== currentUser.id)?.user_id;
  const rowFor = (userId, date) =>
    sleepRows.find((row) => row.user_id === userId && row.record_date === date);

  renderSleepPerson({
    todayRow: rowFor(currentUser.id, today),
    previousRow: rowFor(currentUser.id, previousDate),
    wakeEl: myWakeTime,
    bedtimeEl: myBedtime,
    durationEl: mySleepDuration,
  });
  renderSleepPerson({
    todayRow: partnerId ? rowFor(partnerId, today) : null,
    previousRow: partnerId ? rowFor(partnerId, previousDate) : null,
    wakeEl: partnerWakeTime,
    bedtimeEl: partnerBedtime,
    durationEl: partnerSleepDuration,
  });
}

async function recordSleepTime(field) {
  if (!supabase || !currentUser) return;
  const today = todayISO();
  const existing = sleepRows.find(
    (row) => row.user_id === currentUser.id && row.record_date === today
  );
  const label = field === "wake_at" ? "起床" : "睡觉";
  if (existing?.[field] && !window.confirm(`今天已经记录过${label}时间，要更新为现在吗？`)) {
    return;
  }

  const payload = {
    user_id: currentUser.id,
    record_date: today,
    wake_at: existing?.wake_at || null,
    bedtime_at: existing?.bedtime_at || null,
    [field]: new Date().toISOString(),
  };
  const { error } = await supabase
    .from("sleep_records")
    .upsert(payload, { onConflict: "user_id,record_date" });
  if (error) setError(sleepError, friendlyError(error));
  else loadSleepRecords();
}

function subscribe() {
  if (!supabase) return;
  if (channel) supabase.removeChannel(channel);
  liveStatus.textContent = "正在连接…";
  liveStatus.classList.remove("is-on");
  channel = supabase
    .channel("plans-realtime")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "plans" },
      (payload) => {
        const row = payload.new?.id ? payload.new : payload.old;
        if (!row || row.plan_date === dateInput.value) loadPlans();
      }
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "messages" },
      (payload) => {
        const row = payload.new?.id ? payload.new : payload.old;
        if (!row || row.message_date === dateInput.value) loadMessages();
      }
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "sleep_records" },
      () => loadSleepRecords()
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        liveStatus.textContent = "实时已连接";
        liveStatus.classList.add("is-on");
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        liveStatus.textContent = "实时连接失败，修改后请刷新";
        liveStatus.classList.remove("is-on");
      }
    });
}

async function toggleDone(item) {
  const { error } = await supabase.from("plans").update({ done: !item.done }).eq("id", item.id);
  if (error) setError(planError, friendlyError(error));
  else loadPlans();
}

async function toggleShared(item) {
  const { error } = await supabase
    .from("plans")
    .update({ shared: !item.shared })
    .eq("id", item.id);
  if (error) setError(planError, friendlyError(error));
  else loadPlans();
}

async function removePlan(item) {
  if (!window.confirm("删除这条计划？")) return;
  const { error } = await supabase.from("plans").delete().eq("id", item.id);
  if (error) setError(planError, friendlyError(error));
  else loadPlans();
}

async function removeMessage(item) {
  if (!window.confirm("删除这条留言？")) return;
  const { error } = await supabase.from("messages").delete().eq("id", item.id);
  if (error) setError(planError, friendlyError(error));
  else loadMessages();
}

async function submitMessage(event) {
  event.preventDefault();
  const body = messageBody.value.trim();
  if (!body || !currentUser) return;
  const { error } = await supabase.from("messages").insert({
    user_id: currentUser.id,
    message_date: dateInput.value,
    body,
    reply_to_id: replyTarget?.id || null,
    quoted_plan_id: quotedPlan?.id || null,
    quoted_plan_title: quotedPlan?.title || null,
  });
  if (error) {
    setError(planError, friendlyError(error));
    return;
  }
  messageBody.value = "";
  setMessageContext();
  loadMessages();
}

function boot() {
  if (!supabaseUrl || !supabaseKey) {
    show(configWarning, true);
    show(loginView, false);
    show(planView, false);
    return;
  }

  supabase = createClient(supabaseUrl, supabaseKey);
  dateInput.value = todayISO();

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setError(loginError, "");
    const email = document.querySelector("#email").value.trim();
    const password = document.querySelector("#password").value;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(loginError, friendlyError(error));
  });

  logoutButton.addEventListener("click", async () => {
    await supabase.auth.signOut();
  });

  addForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = newTitle.value.trim();
    if (!title || !currentUser) return;
    const { error } = await supabase.from("plans").insert({
      user_id: currentUser.id,
      plan_date: dateInput.value,
      title,
      done: false,
      shared: false,
    });
    if (error) {
      setError(planError, friendlyError(error));
      return;
    }
    newTitle.value = "";
    loadPlans();
  });

  messageForm.addEventListener("submit", submitMessage);
  clearMessageContextButton.addEventListener("click", () => setMessageContext());
  messageNotice.addEventListener("click", jumpToMessageBoard);
  watchMessageBoardVisibility();
  recordWakeButton.addEventListener("click", () => recordSleepTime("wake_at"));
  recordBedtimeButton.addEventListener("click", () => recordSleepTime("bedtime_at"));
  for (const button of document.querySelectorAll(".page-tab")) {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  }

  dateInput.addEventListener("change", () => {
    setMessageContext();
    loadPlans();
    loadMessages();
  });
  document.querySelector("#prev-day").addEventListener("click", () => {
    dateInput.value = shiftISO(dateInput.value || todayISO(), -1);
    loadPlans();
    loadMessages();
  });
  document.querySelector("#next-day").addEventListener("click", () => {
    dateInput.value = shiftISO(dateInput.value || todayISO(), 1);
    loadPlans();
    loadMessages();
  });
  document.querySelector("#today").addEventListener("click", () => {
    dateInput.value = todayISO();
    loadPlans();
    loadMessages();
  });

  supabase.auth.onAuthStateChange((_event, session) => {
    // 等这次回调结束再请求数据，避免和 Auth 锁互相等待。
    setTimeout(() => {
      if (session?.user) showPlanner(session.user);
      else showLogin();
    }, 0);
  });
}

boot();
