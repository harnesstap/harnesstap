//! `services/cloud-api-error.ts`: reading Cloud error bodies. The HTTP client
//! that raises `CloudApiError` is not ported yet; it builds one with
//! [`CloudApiError::new`].

use serde::Serialize;
use serde_json::{Map, Value};

/// `CloudErrorDetail`.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudErrorDetail {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entry: Option<String>,
    #[serde(rename = "ref", skip_serializing_if = "Option::is_none")]
    pub reference: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fields: Option<Map<String, Value>>,
    /// `Some(Value::Null)` is a `details: null` the body carried.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

fn non_empty(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
}

/// `parseCloudErrorBody`. `body` is `None` for `undefined`; `header_request_id`
/// is the `x-request-id` header.
pub fn parse_cloud_error_body(
    body: Option<&Value>,
    header_request_id: Option<&str>,
) -> CloudErrorDetail {
    let header_id = header_request_id
        .filter(|s| !s.is_empty())
        .map(str::to_owned);
    let top = match body {
        Some(v @ (Value::Object(_) | Value::Array(_))) => v,
        _ => {
            return CloudErrorDetail {
                request_id: header_id,
                ..CloudErrorDetail::default()
            };
        }
    };
    let field = |v: &Value, key: &str| v.as_object().and_then(|o| o.get(key)).cloned();
    let error = field(top, "error");
    let nested = match &error {
        Some(v @ (Value::Object(_) | Value::Array(_))) => v.clone(),
        _ => Value::Object(Map::new()),
    };
    let pick = |key: &str| {
        non_empty(field(&nested, key).as_ref()).or_else(|| non_empty(field(top, key).as_ref()))
    };
    CloudErrorDetail {
        code: non_empty(field(&nested, "code").as_ref())
            .or_else(|| non_empty(error.as_ref()))
            .or_else(|| non_empty(field(top, "code").as_ref())),
        message: pick("message"),
        request_id: pick("requestId")
            .or_else(|| pick("request_id"))
            .or(header_id),
        entry: pick("entry"),
        reference: pick("ref"),
        fields: field(&nested, "fields").and_then(|f| f.as_object().cloned()),
        details: field(&nested, "details"),
    }
}

/// `parseCloudErrorText`: a JSON body that may sit after a status prefix.
pub fn parse_cloud_error_text(text: &str) -> CloudErrorDetail {
    let Some(start) = text.find('{') else {
        return CloudErrorDetail::default();
    };
    match serde_json::from_str::<Value>(&text[start..]) {
        Ok(body) => parse_cloud_error_body(Some(&body), None),
        Err(_) => CloudErrorDetail::default(),
    }
}

/// `CloudApiError`.
#[derive(Debug, Clone, PartialEq)]
pub struct CloudApiError {
    pub message: String,
    pub status: u16,
    pub detail: CloudErrorDetail,
}

impl CloudApiError {
    pub fn new(
        prefix: &str,
        status: u16,
        body: Option<&Value>,
        header_request_id: Option<&str>,
    ) -> Self {
        let detail = parse_cloud_error_body(body, header_request_id);
        let text = detail
            .message
            .clone()
            .or_else(|| detail.code.clone())
            .unwrap_or_else(|| match body {
                None | Some(Value::Null) => "{}".to_owned(),
                Some(v) => emit_rs::json::stringify(v, ""),
            });
        CloudApiError {
            message: format!("{prefix}: {status} {text}"),
            status,
            detail,
        }
    }
}

/// An error as `cloudErrorDetail` sees it: a `CloudApiError`, or any other
/// error by its message.
#[derive(Debug, Clone, PartialEq)]
pub enum CloudFailure {
    Api(Box<CloudApiError>),
    Other(String),
}

impl CloudFailure {
    /// `error instanceof Error ? error.message : String(error)`.
    pub fn message(&self) -> &str {
        match self {
            CloudFailure::Api(e) => &e.message,
            CloudFailure::Other(m) => m,
        }
    }
}

/// `cloudErrorDetail`.
pub fn cloud_error_detail(error: &CloudFailure) -> CloudErrorDetail {
    match error {
        CloudFailure::Api(e) => e.detail.clone(),
        CloudFailure::Other(m) => parse_cloud_error_text(m),
    }
}

/// `requestIdSuffix`.
pub fn request_id_suffix(detail: &CloudErrorDetail) -> String {
    detail
        .request_id
        .as_ref()
        .map_or_else(String::new, |id| format!(" (request {id})"))
}
