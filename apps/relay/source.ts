// SPDX-FileCopyrightText: 2026 Dima Barabash
// SPDX-License-Identifier: AGPL-3.0-only

export const sourcePath = '/source';

// Section 13 of the AGPL: a modified relay that people use over the network
// must offer them its source. The operator names where it is, and a relay
// started with something that isn't a web address refuses to start.
export function sourceUrlFrom(value: string | undefined): string | undefined {
  if (value === undefined || value === '') return undefined;
  const url = URL.canParse(value) ? new URL(value) : null;
  if (url === null || (url.protocol !== 'https:' && url.protocol !== 'http:')) {
    throw new Error(
      `RELAY_SOURCE_URL must be an http(s) address, not ${value}`,
    );
  }
  return url.href;
}

export function sourceNotice(url: string | undefined): string | null {
  return url === undefined
    ? null
    : `This server runs the Nod sync relay, licensed under the GNU Affero General Public License v3.0 only.\nIts source code: ${url}\n`;
}
