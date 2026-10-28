import { mount } from '@vue/test-utils';

export function mountSetup<T>(setup: () => T) {
  let value!: T;
  const wrapper = mount({
    setup() {
      value = setup();
      return () => null;
    },
  });
  return { value, wrapper };
}
