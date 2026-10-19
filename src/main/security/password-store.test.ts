import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { linuxPasswordStore } from './password-store.ts';

describe('linuxPasswordStore', () => {
  it('points desktops Chromium doesn’t know at the Secret Service', () => {
    assert.equal(
      linuxPasswordStore({ XDG_CURRENT_DESKTOP: 'Hyprland' }),
      'gnome-libsecret',
    );
    assert.equal(
      linuxPasswordStore({ XDG_CURRENT_DESKTOP: 'sway' }),
      'gnome-libsecret',
    );
    assert.equal(linuxPasswordStore({}), 'gnome-libsecret');
  });

  it('leaves the desktops Chromium already handles alone, so their keys still open', () => {
    assert.equal(linuxPasswordStore({ XDG_CURRENT_DESKTOP: 'GNOME' }), null);
    assert.equal(
      linuxPasswordStore({ XDG_CURRENT_DESKTOP: 'ubuntu:GNOME' }),
      null,
    );
    assert.equal(linuxPasswordStore({ XDG_CURRENT_DESKTOP: 'KDE' }), null);
    assert.equal(
      linuxPasswordStore({ XDG_CURRENT_DESKTOP: 'X-Cinnamon' }),
      null,
    );
  });
});
