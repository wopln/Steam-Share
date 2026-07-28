export interface ShareContext {
  readonly appId: string;
  readonly title: string;
  readonly url: string;
}

export interface ShareAction {
  readonly id: string;
  readonly label: string;
  execute(context: ShareContext): Promise<void>;
}
