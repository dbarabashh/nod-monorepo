import { Redirect } from 'expo-router';
import { ShowcaseView } from '../features/showcase/index.ts';

export default function ComponentsScreen() {
  return __DEV__ ? <ShowcaseView /> : <Redirect href="/" />;
}
