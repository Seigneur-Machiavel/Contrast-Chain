import { DashboardWsApp, ObserverWsApp } from './apps.mjs';
import { NodeFactory } from '../src/node-factory.mjs';

const factory = new NodeFactory();
new DashboardWsApp(factory, 27272); // network port 27271
//new ObserverWsApp(factory, 27270); // network port 27270