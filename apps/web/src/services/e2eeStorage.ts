import {
  ClientSideFtsEngine,
  FtsDocument,
  FtsSearchResult,
} from "@tescord/types";

export class ClientFtsStorage {
  private engine: ClientSideFtsEngine = new ClientSideFtsEngine();
  private initialized: boolean = false;

  constructor() {
    this.init();
  }

  private init() {
    this.initialized = true;
  }

  // 索引一条已解密的消息至端侧本地倒排索引
  public indexDecryptedMessage(
    id: string,
    channelId: string,
    authorId: string,
    content: string,
    createdAt: string,
  ): void {
    const doc: FtsDocument = {
      id,
      channelId,
      authorId,
      content,
      createdAt,
    };
    this.engine.addDocument(doc);
  }

  // 从端侧本地执行全文检索 (支持中文二元分词与英文前缀词)
  public search(query: string, channelId?: string): FtsSearchResult[] {
    if (!query.trim()) return [];
    return this.engine.search(query, channelId);
  }

  public removeMessage(id: string): void {
    this.engine.removeDocument(id);
  }

  public clear(): void {
    this.engine.clear();
  }

  public get indexedCount(): number {
    return this.engine.size;
  }
}

export const clientFtsStorage = new ClientFtsStorage();
