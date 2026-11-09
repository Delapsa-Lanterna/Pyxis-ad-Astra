//! Cancellation and byte progress belong to the Java dependency operation.
use crate::{Error, Result};
use reqwest::Error as NetworkError;
use serde::Serialize;
use std::future::Future;
use std::result::Result as NetworkResult;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tokio::time::timeout;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferProgress {
    pub phase: &'static str,
    pub completed_bytes: u64,
    pub total_bytes: u64,
    pub files_done: usize,
    pub files_total: usize,
}

#[derive(Clone)]
pub struct TransferControl {
    cancelled: Arc<AtomicBool>,
    report: Arc<dyn Fn(TransferProgress) + Send + Sync>,
}

impl Default for TransferControl {
    fn default() -> Self {
        Self::new(Arc::new(|_| {}))
    }
}

impl TransferControl {
    pub fn new(report: Arc<dyn Fn(TransferProgress) + Send + Sync>) -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(false)),
            report,
        }
    }
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
    }
    pub fn check(&self) -> Result<()> {
        if self.cancelled.load(Ordering::Acquire) {
            Err(Error::Cancelled)
        } else {
            Ok(())
        }
    }
    pub fn progress(&self, progress: TransferProgress) {
        (self.report)(progress);
    }

    /// Retains the same network future across timer ticks; cancellation drops its request.
    pub(crate) async fn network<T>(
        &self,
        future: impl Future<Output = NetworkResult<T, NetworkError>>,
    ) -> Result<T> {
        let mut pending = Box::pin(future);
        loop {
            self.check()?;
            if let Ok(result) = timeout(Duration::from_millis(100), &mut pending).await {
                return result.map_err(Into::into);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::TransferControl;
    use crate::Error;
    use reqwest::Client;
    use std::future::poll_fn;
    use std::io::Read;
    use std::net::TcpListener;
    use std::task::Poll;
    use std::thread;
    use std::time::Duration;
    use tokio::runtime::Builder;

    #[test]
    fn pending_connection_cancellation_and_response_timeout_release_the_future() {
        let runtime = Builder::new_current_thread().enable_all().build().unwrap();
        let control = TransferControl::default();
        let pending = poll_fn(|_| {
            control.cancel();
            Poll::Pending
        });
        assert!(matches!(
            runtime.block_on(control.network::<()>(pending)),
            Err(Error::Cancelled)
        ));
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut bytes = [0u8; 1024];
            assert!(stream.read(&mut bytes).unwrap() > 0);
            thread::sleep(Duration::from_millis(200));
        });
        let result = runtime.block_on(async {
            let client = Client::builder()
                .no_proxy()
                .timeout(Duration::from_millis(50))
                .build()
                .unwrap();
            TransferControl::default()
                .network(client.get(format!("http://{address}")).send())
                .await
        });
        server.join().unwrap();
        assert!(matches!(result, Err(Error::Http(error)) if error.is_timeout()));
    }
}
