// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import ItemCard from '../../components/common/ItemCard';


const baseRemoteServer = {
  id: 'remote-1',
  name: 'Remote Admin Server',
  version: '0.203.175',
  type: 'release',
  icon: 'server',
  path: '',
  lastPlayed: 'Never',
  installed: false,
  isRemote: true,
  serverIp: '10.0.0.42',
  port: '4242',
} satisfies import('../../types').ManagedItem;

const baseLocalServer = {
  ...baseRemoteServer,
  id: 'local-1',
  name: 'Local Server',
  path: '/tmp/local-server',
  isRemote: false,
} satisfies import('../../types').ManagedItem;

describe('ItemCard remote server behavior', () => {
  it('shows the main action instead of a download prompt for remote profiles', () => {
    render(
      <ItemCard
        item={baseRemoteServer}
        actionButtonText="Start"
        statusLabel="Status"
        onAction={vi.fn()}
        onEdit={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /start/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /download/i })).not.toBeInTheDocument();
    expect(screen.getByText('10.0.0.42:4242')).toBeInTheDocument();
  });

  it('disables open-folder action for remote profiles', () => {
    render(
      <ItemCard
        item={baseRemoteServer}
        actionButtonText="Start"
        statusLabel="Status"
        onAction={vi.fn()}
        onEdit={vi.fn()}
        onOpenFolder={vi.fn()}
      />,
    );

    expect(screen.getByLabelText(/open folder/i)).toBeDisabled();
  });

  it('shows local server path details for local entries', () => {
    render(
      <ItemCard
        item={baseLocalServer}
        actionButtonText="Start"
        statusLabel="Status"
        onAction={vi.fn()}
        onEdit={vi.fn()}
      />,
    );

    expect(screen.getByText('/tmp/local-server')).toBeInTheDocument();
  });
});

