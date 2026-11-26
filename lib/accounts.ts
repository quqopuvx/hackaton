export const accountRoleLabels = {
  admin: "Администратор",
  employee: "Сотрудник учебного отдела",
} as const;

export type AccountRole = keyof typeof accountRoleLabels;

export interface Account {
  username: string;
  name: string;
  role: AccountRole;
}

export const auditActionLabels = {
  login: "Вход в аккаунт",
  logout: "Выход из аккаунта",
  search: "Поиск учреждений",
  institution_edit: "Изменение карточки учреждения",
  institution_refresh: "Проверка данных учреждения",
  template_create: "Создание шаблона письма",
  template_edit: "Изменение шаблона письма",
  template_delete: "Удаление шаблона письма",
  mail_send: "Запрос отправки писем",
  campaign_create: "Создание кампании",
  campaign_edit: "Изменение кампании",
  campaign_delete: "Удаление кампании",
  campaign_message: "Сообщение в кампании",
  campaign_school: "Выбор школы в кампании",
} as const;

export type AuditAction = keyof typeof auditActionLabels;

export interface AuditEntry extends Account {
  id: string;
  action: AuditAction;
  details: string | null;
  occurredAt: string;
}
