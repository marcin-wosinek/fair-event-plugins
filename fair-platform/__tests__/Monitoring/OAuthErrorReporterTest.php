<?php
/**
 * OAuthErrorReporter tests: what the Mollie OAuth flows report, what the
 * sent payload may contain, and that reporting never breaks a flow (#2290).
 *
 * @package FairPlatform
 */

namespace FairPlatform\Tests\Monitoring;

use FairPlatform\Monitoring\OAuthErrorReporter;
use PHPUnit\Framework\TestCase;
use Sentry\Breadcrumb;
use Sentry\ClientInterface;
use Sentry\Event;
use Sentry\SentrySdk;
use Sentry\Serializer\PayloadSerializer;
use Sentry\State\Scope;
use Sentry\Transport\Result;
use Sentry\Transport\ResultStatus;
use Sentry\Transport\TransportInterface;

/**
 * Unit tests for the OAuth error-reporting boundary.
 */
class OAuthErrorReporterTest extends TestCase {

	const DSN = 'https://public@example.invalid/1';

	/**
	 * Transport that keeps events instead of sending them.
	 *
	 * @var TransportInterface
	 */
	private $transport;

	/**
	 * Client created with the production configuration.
	 *
	 * @var ClientInterface
	 */
	private $client;

	/**
	 * Superglobals saved before each test.
	 *
	 * @var array
	 */
	private $saved_globals = array();

	/**
	 * Capture events from a client with the production configuration.
	 */
	protected function setUp(): void {
		$this->transport = new class() implements TransportInterface {
			/**
			 * Captured events.
			 *
			 * @var array<Event>
			 */
			public $events = array();

			/**
			 * Keep the event.
			 *
			 * @param Event $event Event.
			 * @return Result
			 */
			public function send( Event $event ): Result {
				$this->events[] = $event;
				return new Result( ResultStatus::success(), $event );
			}

			/**
			 * Nothing to flush.
			 *
			 * @param int|null $timeout Timeout.
			 * @return Result
			 */
			public function close( ?int $timeout = null ): Result {
				return new Result( ResultStatus::success() );
			}
		};
		$this->client    = OAuthErrorReporter::create_client( self::DSN, $this->transport );

		$this->saved_globals              = array( $_GET, $_POST, $_COOKIE, $_SERVER ); // phpcs:ignore WordPress.Security.NonceVerification -- saved for restoring, not processed.
		$GLOBALS['_fair_test_transients'] = array();
	}

	/**
	 * Restore request globals and clear the global Sentry scope.
	 */
	protected function tearDown(): void {
		list( $_GET, $_POST, $_COOKIE, $_SERVER ) = $this->saved_globals;
		SentrySdk::getCurrentHub()->configureScope(
			static function ( Scope $scope ) {
				$scope->clear();
			}
		);
	}

	/**
	 * A reporter using the capturing client.
	 *
	 * @param callable|null $throttle Throttle.
	 * @return OAuthErrorReporter
	 */
	private function reporter( $throttle = null ) {
		$client = $this->client;
		return new OAuthErrorReporter(
			static function () use ( $client ) {
				return $client;
			},
			$throttle
		);
	}

	/**
	 * Serialized payloads of everything sent, as the SDK would transmit them.
	 *
	 * @return string
	 */
	private function sent_payload() {
		$serializer = new PayloadSerializer( $this->client->getOptions() );
		$payloads   = array();
		foreach ( $this->transport->events as $event ) {
			$payloads[] = $serializer->serialize( $event );
		}
		return implode( "\n", $payloads );
	}

	/**
	 * Throw an exception chain carrying markers, from a function that
	 * receives a marker as an argument.
	 *
	 * @param string $refresh_token Marker passed as a stack argument.
	 * @return void
	 * @throws \RuntimeException Always.
	 */
	private function call_mollie( $refresh_token ) {
		// phpcs:disable WordPress.Security.EscapeOutput.ExceptionNotEscaped -- test exceptions, never output.
		throw new \RuntimeException(
			'Refresh failed for marker_outer_message',
			0,
			new \UnexpectedValueException( "Mollie rejected {$refresh_token}" )
		);
		// phpcs:enable
	}

	/**
	 * Secret markers placed in request data, nested exception messages,
	 * breadcrumbs, scope data and stack arguments never reach the payload.
	 */
	public function test_sent_payload_contains_no_request_or_exception_secrets() {
		$_GET                          = array(
			'code'  => 'marker_get_code',
			'state' => 'marker_get_state',
		);
		$_POST                         = array( 'refresh_token' => 'marker_post_refresh_token' );
		$_COOKIE                       = array( 'wordpress_logged_in' => 'marker_cookie' );
		$_SERVER['HTTP_AUTHORIZATION'] = 'Bearer marker_header_token';
		$_SERVER['QUERY_STRING']       = 'code=marker_query_code';
		$_SERVER['REQUEST_URI']        = '/oauth/callback?code=marker_uri_code';

		// Another plugin's Sentry usage on the global hub must not leak in.
		SentrySdk::getCurrentHub()->configureScope(
			static function ( Scope $scope ) {
				$scope->addBreadcrumb( new Breadcrumb( Breadcrumb::LEVEL_INFO, Breadcrumb::TYPE_HTTP, 'http', 'POST /oauth/refresh marker_breadcrumb' ) );
				$scope->setUser( array( 'email' => 'marker_user@example.test' ) );
				$scope->setExtra( 'client_secret', 'marker_extra_secret' );
				$scope->setTag( 'token', 'marker_scope_tag' );
			}
		);

		$reporter = $this->reporter();
		$thrown   = null;
		try {
			$reporter->watch(
				'refresh',
				function () use ( $reporter ) {
					$reporter->report_failure(
						'http_error',
						array(
							'step'        => 'token_refresh',
							'http_status' => 400,
							'oauth_error' => 'marker_provider_error',
						)
					);
					$this->call_mollie( 'marker_stack_argument' );
				}
			);
		} catch ( \RuntimeException $e ) {
			$thrown = $e;
		}

		$this->assertNotNull( $thrown, 'The flow exception is rethrown.' );
		$this->assertSame( 'Refresh failed for marker_outer_message', $thrown->getMessage() );
		$this->assertCount( 2, $this->transport->events );

		$payload = $this->sent_payload();
		$this->assertStringNotContainsString( 'marker', $payload );
		$this->assertStringContainsString( 'RuntimeException', $payload );
		$this->assertStringContainsString( 'UnexpectedValueException', $payload );
		$this->assertStringContainsString( 'fair-platform\\/__tests__\\/Monitoring\\/OAuthErrorReporterTest.php', $payload );
	}

	/** The sent event identifies the flow and failure. */
	public function test_failure_is_sent_with_its_category() {
		$reporter = $this->reporter();
		$reporter->watch(
			'callback',
			static function () use ( $reporter ) {
				$reporter->report_failure( 'transport_failed', array( 'step' => 'token_exchange' ) );
			}
		);

		$this->assertCount( 1, $this->transport->events );
		$event = $this->transport->events[0];
		$this->assertSame( 'Mollie OAuth callback: transport_failed (token_exchange)', $event->getMessage() );
		$this->assertSame( 'callback', $event->getTags()['flow'] );
		$this->assertSame( array(), $event->getBreadcrumbs() );
		$this->assertSame( array(), $event->getRequest() );
	}

	/** Outside a watched flow nothing is reported. */
	public function test_nothing_is_reported_outside_a_flow() {
		$reporter = $this->reporter();
		$reporter->report_failure( 'http_error' );
		$reporter->report_exception( new \RuntimeException( 'x' ) );
		$reporter->report_fatal_error(
			array(
				'type'    => E_ERROR,
				'message' => 'x',
				'file'    => __FILE__,
				'line'    => 1,
			)
		);

		$this->assertSame( array(), $this->transport->events );
	}

	/**
	 * A PHP warning during the flow is reported without its message, and
	 * still reaches the previous error handler; afterwards the previous
	 * handler is active again.
	 */
	public function test_php_error_is_reported_and_passed_on() {
		$previous_calls = array();
		// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.runtime_configuration_error_reporting, WordPress.PHP.DevelopmentFunctions.prevent_path_disclosure_error_reporting -- PHPUnit's level excludes user warnings.
		$previous_level = error_reporting( E_ALL );
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_set_error_handler -- stands in for a site's existing handler.
		set_error_handler(
			static function ( $type, $message ) use ( &$previous_calls ) {
				$previous_calls[] = array( $type, $message );
				return true;
			}
		);

		try {
			$reporter = $this->reporter();
			$reporter->watch(
				'authorize',
				static function () {
					trigger_error( 'state marker_warning_state', E_USER_WARNING ); // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_trigger_error
					trigger_error( 'deprecated marker', E_USER_DEPRECATED ); // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_trigger_error
					@trigger_error( 'suppressed marker', E_USER_WARNING ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged, WordPress.PHP.DevelopmentFunctions.error_log_trigger_error
				}
			);

			trigger_error( 'after the flow', E_USER_NOTICE ); // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_trigger_error
		} finally {
			restore_error_handler();
			error_reporting( $previous_level ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.runtime_configuration_error_reporting, WordPress.PHP.DevelopmentFunctions.prevent_path_disclosure_error_reporting
		}

		$this->assertCount( 4, $previous_calls, 'Every error still reaches the previous handler.' );
		$this->assertSame( array( E_USER_WARNING, 'state marker_warning_state' ), $previous_calls[0] );

		$this->assertCount( 1, $this->transport->events, 'Only the unsuppressed warning during the flow is reported.' );
		$this->assertSame( 'E_USER_WARNING', $this->transport->events[0]->getTags()['php_error_type'] );
		$this->assertStringNotContainsString( 'marker', $this->sent_payload() );
	}

	/** A fatal error during the flow is reported, but not twice for an uncaught exception. */
	public function test_fatal_error_is_reported_once() {
		$reporter = $this->reporter();
		$fatal    = array(
			'type'    => E_ERROR,
			'message' => 'Allowed memory exhausted marker',
			'file'    => __FILE__,
			'line'    => 12,
		);

		$reporter->watch(
			'select_profile',
			static function () use ( $reporter, $fatal ) {
				$reporter->report_fatal_error(
					array(
						'type'    => E_WARNING,
						'message' => 'not fatal',
						'file'    => __FILE__,
						'line'    => 1,
					)
				);
				$reporter->report_fatal_error( $fatal );
				$reporter->report_exception( new \RuntimeException( 'x' ) );
				$reporter->report_fatal_error( array( 'message' => 'Uncaught RuntimeException: x' ) + $fatal );
			}
		);

		$categories = array_map(
			static function ( Event $event ) {
				return $event->getTags()['category'];
			},
			$this->transport->events
		);
		$this->assertSame( array( 'fatal_error', 'exception' ), $categories );
		$this->assertSame( 'fatal', (string) $this->transport->events[0]->getLevel() );
	}

	/** Reporting failures never reach the flow. */
	public function test_reporting_failures_do_not_break_the_flow() {
		$failing_client = $this->createStub( ClientInterface::class );
		$failing_client->method( 'captureEvent' )->willThrowException( new \RuntimeException( 'tracker down' ) );

		$cases = array(
			'client throws'   => new OAuthErrorReporter(
				static function () use ( $failing_client ) {
					return $failing_client;
				}
			),
			'factory throws'  => new OAuthErrorReporter(
				static function () {
					throw new \RuntimeException( 'bad DSN' );
				}
			),
			'throttle throws' => $this->reporter(
				static function () {
					throw new \RuntimeException( 'cache down' );
				}
			),
			'reporting off'   => new OAuthErrorReporter(
				static function () {
					return null;
				}
			),
		);

		foreach ( $cases as $name => $reporter ) {
			$completed = false;
			$reporter->watch(
				'refresh',
				static function () use ( $reporter, &$completed ) {
					$reporter->report_failure( 'http_error' );
					$completed = true;
				}
			);
			$this->assertTrue( $completed, $name );
		}

		$this->assertSame( array(), $this->transport->events );
	}

	/** Without a configured DSN the reporter does nothing. */
	public function test_reporter_without_dsn_is_inert() {
		$this->assertFalse( defined( OAuthErrorReporter::DSN_CONSTANT ) );

		$reporter  = OAuthErrorReporter::from_config();
		$completed = false;
		$reporter->watch(
			'refresh',
			static function () use ( $reporter, &$completed ) {
				$reporter->report_failure( 'http_error' );
				$completed = true;
			}
		);

		$this->assertTrue( $completed );
		$this->assertSame( array(), $GLOBALS['_fair_test_transients'], 'No throttle write without a DSN.' );
	}

	/** A throttled kind is not sent; the throttle sees flow, category and step. */
	public function test_throttle_decides_per_kind() {
		$kinds    = array();
		$reporter = $this->reporter(
			static function ( $kind ) use ( &$kinds ) {
				$kinds[] = $kind;
				return false;
			}
		);
		$reporter->watch(
			'refresh',
			static function () use ( $reporter ) {
				$reporter->report_failure( 'http_error', array( 'step' => 'token_refresh' ) );
			}
		);

		$this->assertSame( array( 'refresh|http_error|token_refresh' ), $kinds );
		$this->assertSame( array(), $this->transport->events );
	}

	/** One request sends a bounded number of events. */
	public function test_events_per_request_are_capped() {
		$reporter = $this->reporter();
		$reporter->watch(
			'refresh',
			static function () use ( $reporter ) {
				for ( $i = 0; $i < 8; $i++ ) {
					$reporter->report_failure( 'http_error' );
				}
			}
		);

		$this->assertCount( OAuthErrorReporter::MAX_EVENTS_PER_REQUEST, $this->transport->events );
	}

	/** After the tracker fails once, the request sends nothing more. */
	public function test_failed_send_stops_reporting_for_the_request() {
		$attempts = 0;
		$failing  = new class( $attempts ) implements TransportInterface {
			/**
			 * Send attempts.
			 *
			 * @var int
			 */
			public $attempts;

			/**
			 * Constructor.
			 *
			 * @param int $attempts Counter.
			 */
			public function __construct( &$attempts ) {
				$this->attempts = &$attempts;
			}

			/**
			 * Fail like an unreachable tracker.
			 *
			 * @param Event $event Event.
			 * @return Result
			 */
			public function send( Event $event ): Result {
				++$this->attempts;
				return new Result( ResultStatus::failed() );
			}

			/**
			 * Nothing to flush.
			 *
			 * @param int|null $timeout Timeout.
			 * @return Result
			 */
			public function close( ?int $timeout = null ): Result {
				return new Result( ResultStatus::success() );
			}
		};
		$client   = OAuthErrorReporter::create_client( self::DSN, $failing );
		$reporter = new OAuthErrorReporter(
			static function () use ( $client ) {
				return $client;
			}
		);

		$reporter->watch(
			'refresh',
			static function () use ( $reporter ) {
				$reporter->report_failure( 'http_error' );
				$reporter->report_failure( 'transport_failed' );
			}
		);

		$this->assertSame( 1, $attempts );
	}

	/** The transient throttle allows a fixed number per kind and window. */
	public function test_transient_throttle_uses_a_fixed_window() {
		for ( $i = 0; $i < OAuthErrorReporter::MAX_EVENTS_PER_WINDOW; $i++ ) {
			$this->assertTrue( OAuthErrorReporter::transient_throttle( 'refresh|http_error|token_refresh' ) );
		}
		$this->assertFalse( OAuthErrorReporter::transient_throttle( 'refresh|http_error|token_refresh' ) );
		$this->assertTrue( OAuthErrorReporter::transient_throttle( 'callback|http_error|token_exchange' ), 'Other kinds are counted separately.' );

		// An expired window starts over.
		foreach ( $GLOBALS['_fair_test_transients'] as $name => $window ) {
			$GLOBALS['_fair_test_transients'][ $name ]['start'] = time() - OAuthErrorReporter::THROTTLE_WINDOW;
		}
		$this->assertTrue( OAuthErrorReporter::transient_throttle( 'refresh|http_error|token_refresh' ) );
	}
}
