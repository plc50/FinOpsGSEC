"""OpenAI-compatible endpoints (BACKEND_CONTEXT §2, §11)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from .. import errors
from ..auth import authenticate
from ..catalog import get_catalog
from ..db import get_session
from ..schemas import ChatCompletionRequest, ModelList, ModelObject
from ..services import pipeline, providers, stream_pipeline

router = APIRouter(prefix="/v1", tags=["openai"])


@router.get("/models", response_model=ModelList)
async def list_models(request: Request) -> ModelList:
    api_key = authenticate(request)
    catalog = get_catalog()
    data = [ModelObject(id="auto", owned_by="finops-proxy")]
    if api_key.can_select_model:
        for model_id in catalog.all_model_ids():
            provider = model_id.split("/", 1)[0]
            data.append(ModelObject(id=model_id, owned_by=provider))
    return ModelList(data=data)


@router.post("/chat/completions")
async def chat_completions(
    request: Request,
    body: ChatCompletionRequest,
    session: AsyncSession = Depends(get_session),
):
    api_key = authenticate(request)

    if body.stream:
        # Run all pre-checks (auth/routing/budget block) before opening the
        # stream so errors surface as normal JSON responses (§11.1).
        plan, cache_hit = await stream_pipeline.prepare(session, api_key, body)
        if cache_hit is not None:
            generator = stream_pipeline.stream_cache_hit(
                session, api_key, plan, cache_hit
            )
            return StreamingResponse(generator, media_type="text/event-stream")
        payload = providers.build_backend_payload(
            plan.request_body, plan.selected, plan.effective_max_tokens
        )
        try:
            opened_stream = await providers.open_backend_stream(
                plan.provider, payload, plan.selected.id
            )
        except providers.ProviderError as exc:
            await stream_pipeline.persist_provider_stream_error(session, api_key, plan)
            raise errors.provider_error(
                exc.message,
                http_status=exc.http_status,
                type=exc.error_type,
                code=exc.error_code,
                param=exc.error_param,
            ) from exc
        generator = stream_pipeline.stream_with_plan(
            session, api_key, body, plan, request, opened_stream=opened_stream
        )
        return StreamingResponse(generator, media_type="text/event-stream")

    completion, _audit = await pipeline.run_chat_completion(session, api_key, body)
    return JSONResponse(content=completion)
