import { IApi } from '@umijs/types';
import path from 'path';
import { Bundler } from './bundler-mako';
// @ts-ignore
import express from '@umijs/deps/compiled/express';
// @ts-ignore
import { getHtmlGenerator } from '@umijs/preset-built-in/lib/plugins/commands/htmlUtils';
import { writeFileSync } from 'fs';
import { join } from 'path';

export default function (api: IApi) {
  api.describe({
    key: 'mako',
    config: {
      schema(joi) {
        return joi.object();
      },
    },
  });
  if (!api.userConfig.mako) return;
  if (api.userConfig.ssr) {
    console.log('mako bundler no support ssr!');
    return;
  }
  api.modifyConfig(async (memo) => {
    return {
      ...memo,
      mfsu: false,
    };
  });
  api.modifyBundler(() => {
    return Bundler;
  });
  api.onStart(() => {
    process.env.HMR = 'none';
    try {
      const pkg = require(path.join(
        require.resolve('@umijs/mako'),
        '../../package.json',
      ));
      api.logger.info(`Using mako@${pkg.version}`);
    } catch (e) {
      console.error(e);
    }
  });

  api.onBuildComplete(async ({ err, stats }) => {
    console.log('mako build complete');
    if (!err) {
      const compilation = (stats as any).toJson();
      const html = getHtmlGenerator({ api });
      const routeMap = await api.applyPlugins({
        key: 'modifyExportRouteMap',
        type: api.ApplyPluginsType.modify,
        initialValue: [{ route: { path: '/' }, file: 'index.html' }],
        args: {
          html,
        },
      });
      for (const { route, file } of routeMap) {
        const defaultContent = await html.getContent({
          route,
          assets: compilation.assets,
          chunks: compilation.chunks,
        });
        const content = await api.applyPlugins({
          key: 'modifyProdHTMLContent',
          type: api.ApplyPluginsType.modify,
          initialValue: defaultContent,
          args: {
            route,
            file,
          },
        });
        const outputHtml = join(api.paths.absOutputPath!, file);
        writeFileSync(outputHtml, content, 'utf-8');
      }
    }
  });
  api.addBeforeMiddlewares(() => {
    const outputPath = path.resolve(
      api.paths.cwd!,
      api.config.outputPath || 'dist',
    );
    // cors
    // compression
    // history fallback
    // serve dist files
    return [
      require('cors')({
        origin: true,
        methods: ['GET', 'HEAD', 'PUT', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
        credentials: true,
      }),
      require('compression')(),
      ...(api.config.mako.disableConnectHistoryApiFallback
        ? []
        : [require('connect-history-api-fallback')({ index: '/' })]),
      express.static(outputPath),
    ];
  });
  api.modifyBundleConfig((bundleConfig: any, { bundler: { id }, type }) => {
    if (id === 'mako') {
      bundleConfig.onCompileDone = ({ isFirstCompile, stats }: any) => {
        if (isFirstCompile) {
          api.service.emit('firstDevCompileDone');
        }
        api
          .applyPlugins({
            key: 'onDevCompileDone',
            type: api.ApplyPluginsType.event,
            args: {
              isFirstCompile,
              type,
              stats,
            },
          })
          .catch((e) => {
            console.error(e.stack);
          });
      };
      bundleConfig.onCompileFail = () => {};
    }
    return bundleConfig;
  });
}
