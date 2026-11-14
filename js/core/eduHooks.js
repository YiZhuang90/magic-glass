// 教学层预留接口（第一阶段只有默认实现）。
// 后续阶段可替换为：按主题周的内容库、按年龄的难度档、可导出的匿名记录。

/** 难度档：玩法层只读取这里的参数，不写死。 */
export const DifficultyProfiles = {
  default5: { id: 'default5', label: '5 岁（默认）', brushScale: 1.0, fogStrength: 1.0, mudStrength: 0.34 },
  // 预留：'age3_4'、'age4_5'、'age5_6'
};

/** 匿名事件记录：只保存在内存，不含任何影像，关闭页面即消失。 */
export class EventLog {
  constructor(limit = 500) { this.items = []; this.limit = limit; }
  record(type, data = {}) {
    this.items.push({ t: Date.now(), type, ...data });
    if (this.items.length > this.limit) this.items.shift();
  }
  summary() {
    const done = this.items.filter(i => i.type === 'card_complete');
    return { cardsCompleted: done.length, avgSeconds: done.length ? done.reduce((a, b) => a + b.seconds, 0) / done.length : 0 };
  }
}

/** 课程计划（预留）：把多个题目串成一节活动。第一阶段不启用。 */
export const LessonPlan = null;

/** 设备桥（预留）：ESP32 按钮 / 灯效，通过 WebSerial 或 WebSocket。第一阶段为空实现。 */
export const DeviceBridge = {
  connected: false,
  send(_event, _data) {},
};
