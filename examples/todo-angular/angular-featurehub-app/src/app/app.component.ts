import { Component, OnInit } from '@angular/core';
import {
  EdgeFeatureHubConfig,
  ClientContext,
  fhLog
} from 'featurehub-javascript-client-sdk';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.sass']
})
export class AppComponent implements OnInit  {
  title = 'angular-basic-featurehub';

  // @ts-ignore
  fhContext: ClientContext;

  ngOnInit() {
    fhLog.quiet();
    const fhConfig = new EdgeFeatureHubConfig('http://localhost:8085', 'default/ff3af4b1-e349-4fc7-bcca-31f3e70448de/geKsyslBOBKBUQxG6yE1JuTw0NZrD02GgEvL045s')
    fhConfig.newContext().build().then(context => this.fhContext = context);
  }
}
