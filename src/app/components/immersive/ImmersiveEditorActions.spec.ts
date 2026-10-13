import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { NButton } from 'naive-ui';
import ImmersiveEditorActions from './ImmersiveEditorActions.vue';
describe('shared immersive meta actions', () => {
  it('consumes saving and history state and dispatches each action once', async () => {
    const own = mount(ImmersiveEditorActions, {
      props: { canUndo: true, canRedo: false, saving: false, ready: true },
      global: { components: { NButton } },
    });
    const buttons = own.findAll('button');
    expect(buttons.map((button) => button.text())).toEqual(['撤销', '重做', '保存', '关闭']);
    expect(buttons[1]!.attributes('disabled')).toBeDefined();
    await buttons[0]!.trigger('click');
    await buttons[2]!.trigger('click');
    await buttons[3]!.trigger('click');
    expect(own.emitted('undo')).toHaveLength(1);
    expect(own.emitted('save')).toHaveLength(1);
    expect(own.emitted('close')).toHaveLength(1);
    await own.setProps({ saving: true });
    expect(buttons[0]!.attributes('disabled')).toBeDefined();
    own.unmount();
  });
});
