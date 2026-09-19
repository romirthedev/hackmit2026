"""Local inference wire formats; images remain in their supplied order."""


def chat_request(api, model, messages, schema, *, think=False, context=16384, max_tokens=2048):
    if api == "ollama":
        return "/api/chat", {
            "model": model,
            "messages": messages,
            "format": schema,
            "stream": False,
            "think": think,
            "keep_alive": "30m",
            "options": {"temperature": 0, "num_ctx": context, "num_predict": max_tokens},
        }
    if api != "llamacpp":
        raise ValueError(f"Unsupported local inference API: {api}")
    converted = []
    for message in messages:
        parts = [{"type": "text", "text": message["content"]}]
        parts.extend(
            {
                "type": "image_url",
                "image_url": {
                    "url": "data:image/jpeg;base64," + image,
                },
            }
            for image in message.get("images", [])
        )
        converted.append(
            {"role": message["role"], "content": parts if len(parts) > 1 else message["content"]}
        )
    # llama.cpp context/slot capacity is set at server launch, not per request.
    return "/v1/chat/completions", {
        "model": model,
        "messages": converted,
        "stream": False,
        "temperature": 0,
        "max_tokens": max_tokens,
        "cache_prompt": False,
        "chat_template_kwargs": {"enable_thinking": think},
        "response_format": {"type": "json_schema", "json_schema": {"name": "result", "schema": schema}},
    }


def chat_result(api, raw):
    if api == "ollama":
        return raw["message"]["content"], raw.get("done") is True and raw.get("done_reason") != "length"
    choice = raw["choices"][0]
    return choice["message"]["content"], choice.get("finish_reason") == "stop"
