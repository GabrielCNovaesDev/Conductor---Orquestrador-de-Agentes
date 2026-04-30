export type ConnectorType = 'jira' | 'github';

export interface ConnectorStatus {
  type: ConnectorType;
  connected: boolean;
}
