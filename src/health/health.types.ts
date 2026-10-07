export interface LivenessResponse {
  status: 'ok';
  service: 'moc-maria-api';
}

export interface ReadinessResponse {
  status: 'ok';
  service: 'moc-maria-api';
  checks: {
    database: 'up';
  };
}
