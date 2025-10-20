import Block from "components/services/widget/block";
import Container from "components/services/widget/container";
import { useTranslation } from "next-i18next";

import useWidgetAPI from "utils/proxy/use-widget-api";

export default function Component({ service }) {
  const { t } = useTranslation();

  const { widget } = service;

  const { data: dispatcharrData, error: dispatcharrError } = useWidgetAPI(widget);

  if (dispatcharrError) {
    return <Container service={service} error={dispatcharrError} />;
  }

  if (!dispatcharrData) {
    return (
      <Container service={service}>
        <Block label="dispatcharr.channels" />
        <Block label="dispatcharr.streams" />
        <Block label="dispatcharr.active_streams" />
      </Container>
    );
  }

  return (
    <Container service={service}>
      <Block label="dispatcharr.channels" value={t("common.number", { value: dispatcharrData.channels ?? 0 })} />
      <Block label="dispatcharr.streams" value={t("common.number", { value: dispatcharrData.streams ?? 0 })} />
      <Block label="dispatcharr.active_streams" value={t("common.number", { value: dispatcharrData.active_streams ?? 0 })} />
    </Container>
  );
}

