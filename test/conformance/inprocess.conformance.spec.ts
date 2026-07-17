import { InProcessChecker } from '../../src/checker/inprocess';
import { runCheckerConformance } from './checker-conformance';

runCheckerConformance('in-process', () => new InProcessChecker());
