<?php
/**
 * Error reporting for the Mollie OAuth flows
 *
 * @package FairPlatform
 */

namespace FairPlatform\Monitoring;

use Sentry\ClientBuilder;
use Sentry\ClientInterface;
use Sentry\Event;
use Sentry\Transport\TransportInterface;

defined( 'ABSPATH' ) || die;

/**
 * Reports failures in the Mollie OAuth flows (authorize, callback, profile
 * selection, refresh) to Sentry (#2290).
 *
 * It is active only while a flow runs: `watch()` reports exceptions, PHP
 * errors and fatal errors raised during the flow, and the flow reports its
 * operational failures with `report_failure()`. Nothing else on the site is
 * observed: the SDK gets no global hub, no default integrations and no
 * error handlers of its own.
 *
 * Every event is built and re-checked by SafeEvent, so only fixed categories
 * and safe stack locations leave the site. Reporting never changes what the
 * flow answers: it swallows its own failures, passes PHP errors on to the
 * previous handler, and rethrows the flow's exceptions.
 *
 * Without a DSN (`FAIR_PLATFORM_SENTRY_DSN` in wp-config.php) it does nothing.
 */
class OAuthErrorReporter {

	/**
	 * Constant holding the Sentry DSN.
	 */
	const DSN_CONSTANT = 'FAIR_PLATFORM_SENTRY_DSN';

	/**
	 * Most events one request sends.
	 */
	const MAX_EVENTS_PER_REQUEST = 5;

	/**
	 * Most events of one kind (flow, category, step) per throttle window, so
	 * public endpoints can't be used to flood the tracker.
	 */
	const MAX_EVENTS_PER_WINDOW = 10;

	/**
	 * Throttle window in seconds.
	 */
	const THROTTLE_WINDOW = 3600;

	/**
	 * PHP errors reported during a flow. Deprecations are left out.
	 */
	const REPORTED_ERRORS = E_WARNING | E_NOTICE | E_USER_ERROR | E_USER_WARNING | E_USER_NOTICE | E_RECOVERABLE_ERROR;

	/**
	 * PHP errors that end the request.
	 */
	const FATAL_ERRORS = E_ERROR | E_PARSE | E_CORE_ERROR | E_COMPILE_ERROR;

	/**
	 * Creates the Sentry client, or returns null when reporting is off.
	 *
	 * @var callable(): (ClientInterface|null)
	 */
	private $client_factory;

	/**
	 * Decides whether an event of a kind may be sent now.
	 *
	 * @var callable(string): bool
	 */
	private $throttle;

	/**
	 * Sentry client, created on the first event; false until then.
	 *
	 * @var ClientInterface|null|false
	 */
	private $client = false;

	/**
	 * Flow being watched, or null.
	 *
	 * @var string|null
	 */
	private $flow = null;

	/**
	 * Error handler that was active before the flow started.
	 *
	 * @var callable|null
	 */
	private $previous_error_handler = null;

	/**
	 * Whether the flow's exception was already reported, so the fatal
	 * "Uncaught" error at shutdown isn't reported twice.
	 *
	 * @var bool
	 */
	private $exception_reported = false;

	/**
	 * Whether the shutdown check is registered.
	 *
	 * @var bool
	 */
	private $shutdown_registered = false;

	/**
	 * Whether an event is being sent; guards against errors raised while
	 * reporting being reported again.
	 *
	 * @var bool
	 */
	private $sending = false;

	/**
	 * Events sent in this request.
	 *
	 * @var int
	 */
	private $sent = 0;

	/**
	 * PHP error locations already reported in this request.
	 *
	 * @var array<string, true>
	 */
	private $seen_errors = array();

	/**
	 * Constructor.
	 *
	 * @param callable      $client_factory Returns the Sentry client, or null when reporting is off.
	 * @param callable|null $throttle       Given an event kind, whether it may be sent; allows all when null.
	 */
	public function __construct( callable $client_factory, $throttle = null ) {
		$this->client_factory = $client_factory;
		$this->throttle       = is_callable( $throttle ) ? $throttle : static function () {
			return true;
		};
	}

	/**
	 * Reporter configured from wp-config.php, throttled with transients.
	 *
	 * @return self
	 */
	public static function from_config() {
		$dsn = defined( self::DSN_CONSTANT ) ? constant( self::DSN_CONSTANT ) : '';

		return new self(
			static function () use ( $dsn ) {
				return is_string( $dsn ) && '' !== trim( $dsn ) ? self::create_client( trim( $dsn ) ) : null;
			},
			array( self::class, 'transient_throttle' )
		);
	}

	/**
	 * Sentry client with the scoped, scrubbing configuration.
	 *
	 * @param string                  $dsn       Sentry DSN.
	 * @param TransportInterface|null $transport Transport; the SDK's HTTP transport when null.
	 * @return ClientInterface
	 */
	public static function create_client( $dsn, $transport = null ) {
		$builder = ClientBuilder::create(
			array(
				'dsn'                   => $dsn,
				'release'               => defined( 'FAIR_PLATFORM_VERSION' ) ? 'fair-platform@' . FAIR_PLATFORM_VERSION : null,
				'environment'           => function_exists( 'wp_get_environment_type' ) ? wp_get_environment_type() : 'production',
				'default_integrations'  => false,
				'integrations'          => array(),
				'send_default_pii'      => false,
				'send_client_reports'   => false,
				'attach_stacktrace'     => false,
				'context_lines'         => null,
				'max_breadcrumbs'       => 0,
				'max_request_body_size' => 'never',
				'server_name'           => '',
				'http_connect_timeout'  => 1,
				'http_timeout'          => 2,
				'before_send'           => array( SafeEvent::class, 'sanitize' ),
			)
		);

		if ( $transport instanceof TransportInterface ) {
			$builder->setTransport( $transport );
		}

		return $builder->getClient();
	}

	/**
	 * Fixed-window throttle stored in a transient per event kind.
	 *
	 * @param string $kind Event kind.
	 * @return bool
	 */
	public static function transient_throttle( $kind ) {
		$name   = 'fair_platform_report_' . hash( 'sha256', $kind );
		$now    = time();
		$window = get_transient( $name );
		if ( ! is_array( $window ) || ! isset( $window['count'], $window['start'] ) || $now - (int) $window['start'] >= self::THROTTLE_WINDOW ) {
			$window = array(
				'count' => 0,
				'start' => $now,
			);
		}

		if ( (int) $window['count'] >= self::MAX_EVENTS_PER_WINDOW ) {
			return false;
		}

		++$window['count'];
		set_transient( $name, $window, max( 1, (int) $window['start'] + self::THROTTLE_WINDOW - $now ) );

		return true;
	}

	/**
	 * Run a flow, reporting its exceptions, PHP errors and fatal errors.
	 *
	 * The flow's own behavior is unchanged: its exceptions are rethrown and
	 * PHP errors still reach the previous handler. Flows usually end the
	 * request with `exit`; the error handler then stays active until shutdown.
	 *
	 * @param string   $flow    Flow (see SafeEvent::FLOWS).
	 * @param callable $handler The flow.
	 * @return void
	 * @throws \Throwable Whatever the flow throws.
	 */
	public function watch( $flow, callable $handler ) {
		$this->flow               = $flow;
		$this->exception_reported = false;
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_set_error_handler -- scoped to the flow and restored after it; errors still reach the previous handler.
		$this->previous_error_handler = set_error_handler( array( $this, 'handle_php_error' ) );

		if ( ! $this->shutdown_registered ) {
			$this->shutdown_registered = true;
			register_shutdown_function( array( $this, 'handle_shutdown' ) );
		}

		try {
			$handler();
		} catch ( \Throwable $throwable ) {
			$this->report_exception( $throwable );
			throw $throwable;
		} finally {
			restore_error_handler();
			$this->previous_error_handler = null;
			$this->flow                   = null;
		}
	}

	/**
	 * Report an operational failure of the flow being watched.
	 *
	 * @param string $category Category (see SafeEvent::CATEGORIES).
	 * @param array  $details  Optional `step`, `http_status` and `oauth_error`.
	 * @return void
	 */
	public function report_failure( $category, array $details = array() ) {
		if ( null === $this->flow ) {
			return;
		}

		$flow = $this->flow;
		$this->send(
			$flow . '|' . $category . '|' . ( $details['step'] ?? '' ),
			static function () use ( $flow, $category, $details ) {
				return SafeEvent::failure( $flow, $category, $details );
			}
		);
	}

	/**
	 * Report an exception thrown by the flow being watched.
	 *
	 * @param \Throwable $throwable What was thrown.
	 * @return void
	 */
	public function report_exception( \Throwable $throwable ) {
		if ( null === $this->flow ) {
			return;
		}

		$this->exception_reported = true;
		$flow                     = $this->flow;
		$this->send(
			$flow . '|exception|' . get_class( $throwable ),
			static function () use ( $flow, $throwable ) {
				return SafeEvent::exception( $flow, $throwable );
			}
		);
	}

	/**
	 * Error handler active during a flow. Reports the error without its
	 * message, then lets the previous handler (or PHP) handle it as before.
	 *
	 * @param int    $type    Error type.
	 * @param string $message Error message (never reported).
	 * @param string $file    File.
	 * @param int    $line    Line.
	 * @return bool Whether the error was handled.
	 */
	public function handle_php_error( $type, $message, $file = '', $line = 0 ) {
		// Reading the level respects the site's configuration and the @ operator.
		// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.runtime_configuration_error_reporting, WordPress.PHP.DevelopmentFunctions.prevent_path_disclosure_error_reporting
		if ( null !== $this->flow && ( error_reporting() & $type ) && ( self::REPORTED_ERRORS & $type ) ) {
			$location = $type . '|' . $file . '|' . $line;
			if ( ! isset( $this->seen_errors[ $location ] ) ) {
				$this->seen_errors[ $location ] = true;

				$flow = $this->flow;
				// Frame 0 is this handler, called by PHP.
				$trace = array_slice( debug_backtrace( DEBUG_BACKTRACE_IGNORE_ARGS ), 1 ); // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_debug_backtrace -- arguments are ignored; only locations are kept.
				$this->send(
					$flow . '|php_error|' . $type,
					static function () use ( $flow, $type, $file, $line, $trace ) {
						return SafeEvent::php_error( $flow, 'php_error', $type, $file, $line, $trace );
					}
				);
			}
		}

		if ( is_callable( $this->previous_error_handler ) ) {
			return (bool) call_user_func( $this->previous_error_handler, $type, $message, $file, $line );
		}

		return false;
	}

	/**
	 * Shutdown check: report a fatal error that ended a flow.
	 *
	 * @return void
	 */
	public function handle_shutdown() {
		$this->report_fatal_error( error_get_last() );
	}

	/**
	 * Report a fatal error from `error_get_last()`, if the flow was running
	 * and it isn't the uncaught exception already reported.
	 *
	 * @param array|null $error Last error.
	 * @return void
	 */
	public function report_fatal_error( $error ) {
		if ( null === $this->flow || ! is_array( $error ) || ! isset( $error['type'] ) || ! ( self::FATAL_ERRORS & (int) $error['type'] ) ) {
			return;
		}

		if ( $this->exception_reported && 0 === strpos( (string) ( $error['message'] ?? '' ), 'Uncaught ' ) ) {
			return;
		}

		$flow = $this->flow;
		$type = (int) $error['type'];
		$file = (string) ( $error['file'] ?? '' );
		$line = (int) ( $error['line'] ?? 0 );
		$this->send(
			$flow . '|fatal_error|' . $type,
			static function () use ( $flow, $type, $file, $line ) {
				return SafeEvent::php_error( $flow, 'fatal_error', $type, $file, $line );
			}
		);
	}

	/**
	 * Send an event, unless reporting is off, the limits are reached or
	 * reporting fails. Never throws.
	 *
	 * @param string   $kind  Event kind, for throttling.
	 * @param callable $build Returns the Event.
	 * @return void
	 */
	private function send( $kind, callable $build ) {
		if ( $this->sending || $this->sent >= self::MAX_EVENTS_PER_REQUEST ) {
			return;
		}

		$this->sending = true;
		try {
			$client = $this->client();
			if ( null === $client || ! call_user_func( $this->throttle, $kind ) ) {
				return;
			}

			$event = $build();
			if ( $event instanceof Event ) {
				++$this->sent;
				// No event ID means the tracker failed or rate-limited the
				// event; don't spend more of this request's time on it.
				if ( null === $client->captureEvent( $event ) ) {
					$this->sent = self::MAX_EVENTS_PER_REQUEST;
				}
			}
		} catch ( \Throwable $reporting_failure ) {
			// Reporting must never break an OAuth answer.
			unset( $reporting_failure );
		} finally {
			$this->sending = false;
		}
	}

	/**
	 * The Sentry client, created once.
	 *
	 * @return ClientInterface|null
	 */
	private function client() {
		if ( false === $this->client ) {
			$this->client = null;
			$client       = call_user_func( $this->client_factory );
			if ( $client instanceof ClientInterface ) {
				$this->client = $client;
			}
		}

		return $this->client;
	}
}
