<?php
/**
 * SafeEvent tests: what an OAuth error report may contain (#2290).
 *
 * @package FairPlatform
 */

namespace FairPlatform\Tests\Monitoring;

use FairPlatform\Monitoring\SafeEvent;
use PHPUnit\Framework\TestCase;
use Sentry\Breadcrumb;
use Sentry\Event;
use Sentry\ExceptionDataBag;
use Sentry\Frame;
use Sentry\Options;
use Sentry\Serializer\PayloadSerializer;
use Sentry\Stacktrace;
use Sentry\UserDataBag;

/**
 * Unit tests for the allowlisted error-tracker events.
 */
class SafeEventTest extends TestCase {

	/** A failure carries its fixed category, step and validated details. */
	public function test_failure_carries_only_validated_tags() {
		$event = SafeEvent::failure(
			'refresh',
			'http_error',
			array(
				'step'        => 'token_refresh',
				'http_status' => 400,
				'oauth_error' => 'invalid_grant',
				'token'       => 'not-a-tag',
			)
		);

		$this->assertSame(
			array(
				'flow'        => 'refresh',
				'category'    => 'http_error',
				'step'        => 'token_refresh',
				'http_status' => '400',
				'oauth_error' => 'invalid_grant',
			),
			$event->getTags()
		);
		$this->assertSame( 'Mollie OAuth refresh: http_error (token_refresh)', $event->getMessage() );
		$this->assertSame( array(), $event->getExceptions() );
	}

	/** Values outside the fixed lists are replaced, never passed through. */
	public function test_unknown_values_are_replaced() {
		$event = SafeEvent::failure(
			'refresh_token=marker',
			'marker category',
			array(
				'step'        => 'marker',
				'http_status' => 'marker',
				'oauth_error' => 'marker_provider_error',
			)
		);

		$this->assertSame(
			array(
				'flow'        => 'unknown',
				'category'    => 'other',
				'step'        => 'other',
				'oauth_error' => 'other',
			),
			$event->getTags()
		);
	}

	/** Out-of-range statuses and an empty OAuth error are left out. */
	public function test_invalid_status_and_empty_oauth_error_are_dropped() {
		$tags = SafeEvent::failure(
			'callback',
			'http_error',
			array(
				'http_status' => 0,
				'oauth_error' => '',
			)
		)->getTags();

		$this->assertArrayNotHasKey( 'http_status', $tags );
		$this->assertArrayNotHasKey( 'oauth_error', $tags );
	}

	/** An exception keeps its class and locations, never its message. */
	public function test_exception_keeps_class_and_location_only() {
		$throwable = $this->throw_with( 'marker_secret_message' );
		$event     = SafeEvent::exception( 'callback', $throwable );

		$exceptions = $event->getExceptions();
		$this->assertCount( 1, $exceptions );
		$this->assertSame( \RuntimeException::class, $exceptions[0]->getType() );
		$this->assertSame( SafeEvent::EXCEPTION_VALUE, $exceptions[0]->getValue() );

		$frames = $exceptions[0]->getStacktrace()->getFrames();
		$last   = end( $frames );
		$this->assertSame( 'fair-platform/__tests__/Monitoring/SafeEventTest.php', $last->getFile() );
		$this->assertSame( __CLASS__ . '->throw_with', $last->getFunctionName() );
		$this->assertNull( $last->getAbsoluteFilePath() );
		$this->assertSame( array(), $last->getVars() );
		$this->assertSame(
			array(
				'flow'     => 'callback',
				'category' => 'exception',
			),
			$event->getTags()
		);
	}

	/** Previous exceptions are listed by class, innermost first. */
	public function test_previous_exceptions_are_listed_by_class() {
		$throwable = new \LogicException( 'outer marker', 0, new \InvalidArgumentException( 'inner marker' ) );

		$types = array_map(
			static function ( ExceptionDataBag $exception ) {
				return $exception->getType();
			},
			SafeEvent::exception( 'refresh', $throwable )->getExceptions()
		);

		$this->assertSame( array( \InvalidArgumentException::class, \LogicException::class ), $types );
	}

	/** A PHP error is reported by type and location, without its message. */
	public function test_php_error_reports_type_and_location() {
		$event = SafeEvent::php_error( 'authorize', 'php_error', E_WARNING, __FILE__, 42 );

		$this->assertSame( 'E_WARNING', $event->getTags()['php_error_type'] );
		$frames = $event->getExceptions()[0]->getStacktrace()->getFrames();
		$this->assertSame( 42, end( $frames )->getLine() );
		$this->assertSame( 'E_WARNING', $event->getExceptions()[0]->getType() );
		$this->assertTrue( $event->getExceptions()[0]->getMechanism()->isHandled(), 'A warning is not a crash.' );
		$this->assertFalse( SafeEvent::sanitize( SafeEvent::php_error( 'authorize', 'fatal_error', E_ERROR, __FILE__, 1 ) )->getExceptions()[0]->getMechanism()->isHandled() );
		$this->assertTrue( SafeEvent::sanitize( $event )->getExceptions()[0]->getMechanism()->isHandled() );
	}

	/** Paths outside the plugins directory and WordPress keep only the file name. */
	public function test_relative_path_hides_server_layout() {
		$this->assertSame( 'fair-platform/src/Core/Plugin.php', SafeEvent::relative_path( dirname( __DIR__, 3 ) . '/fair-platform/src/Core/Plugin.php' ) );
		$this->assertSame( 'wp-includes/load.php', SafeEvent::relative_path( ABSPATH . 'wp-includes/load.php' ) );
		$this->assertSame( 'secret.php', SafeEvent::relative_path( '/home/marker_user/secret.php' ) );
		$this->assertSame( 'file.php', SafeEvent::relative_path( 'C:\\Users\\marker\\file.php' ) );
		$this->assertSame( '[unknown]', SafeEvent::relative_path( 'php://input?token=marker' ) );
		$this->assertSame( '[unknown]', SafeEvent::relative_path( '' ) );
	}

	/** A cancelled authorization is not a failure; other errors are. */
	public function test_cancellation_is_not_reportable() {
		$this->assertFalse( SafeEvent::is_reportable_authorization_error( 'access_denied' ) );
		$this->assertTrue( SafeEvent::is_reportable_authorization_error( 'server_error' ) );
		$this->assertTrue( SafeEvent::is_reportable_authorization_error( 'invalid_scope' ) );
	}

	/**
	 * Whatever another part of the SDK attaches, sanitize() sends only the
	 * allowlisted parts.
	 */
	public function test_sanitize_drops_everything_outside_the_allowlist() {
		$marker = 'marker_sanitize_7f3a';
		$event  = Event::createEvent();
		$event->setMessage( "token {$marker}" );
		$event->setTags(
			array(
				'flow'     => 'refresh',
				'category' => 'http_error',
				'token'    => $marker,
			)
		);
		$event->setRequest(
			array(
				'url'          => "https://example.test/oauth/refresh?refresh_token={$marker}",
				'data'         => array( 'refresh_token' => $marker ),
				'headers'      => array( 'Authorization' => "Bearer {$marker}" ),
				'cookies'      => array( 'session' => $marker ),
				'query_string' => "code={$marker}",
			)
		);
		$event->setUser( UserDataBag::createFromUserIdentifier( $marker ) );
		$event->setExtra( array( 'client_secret' => $marker ) );
		$event->setContext( 'oauth', array( 'state' => $marker ) );
		$event->setBreadcrumb( array( new Breadcrumb( Breadcrumb::LEVEL_INFO, Breadcrumb::TYPE_DEFAULT, 'http', "GET ?code={$marker}" ) ) );
		$event->setModules( array( $marker => '1.0' ) );
		$event->setServerName( $marker );
		$event->setTransaction( "/oauth/callback?code={$marker}" );
		$event->setRelease( "release {$marker} with spaces" );

		$frame = new Frame( "fn_{$marker}(", "/srv/{$marker}/file.php", 10, null, "/srv/{$marker}/file.php", array( 'refresh_token' => $marker ) );
		$frame->setPreContext( array( "\$token = '{$marker}';" ) );
		$frame->setContextLine( "throw new Exception('{$marker}');" );
		$exception = new ExceptionDataBag( new \RuntimeException( $marker ), new Stacktrace( array( $frame ) ) );
		$exception->setType( "Type {$marker}!" );
		$event->setExceptions( array( $exception ) );

		$safe    = SafeEvent::sanitize( $event );
		$payload = $this->serialize( $safe );

		$this->assertStringNotContainsString( $marker, $payload );
		$this->assertSame( $event->getId(), $safe->getId() );
		$this->assertSame( 'Throwable', $safe->getExceptions()[0]->getType() );
		$this->assertSame( 'file.php', $safe->getExceptions()[0]->getStacktrace()->getFrames()[0]->getFile() );
		$this->assertNull( $safe->getServerName() );
		$this->assertNull( $safe->getRelease() );
	}

	/** Release and environment labels survive sanitizing. */
	public function test_sanitize_keeps_release_and_environment() {
		$event = SafeEvent::failure( 'refresh', 'http_error' );
		$event->setRelease( 'fair-platform@1.5.2' );
		$event->setEnvironment( 'production' );

		$safe = SafeEvent::sanitize( $event );

		$this->assertSame( 'fair-platform@1.5.2', $safe->getRelease() );
		$this->assertSame( 'production', $safe->getEnvironment() );
	}

	/**
	 * Serialize an event as the SDK would send it.
	 *
	 * @param Event $event Event.
	 * @return string
	 */
	private function serialize( Event $event ) {
		return ( new PayloadSerializer( new Options( array( 'dsn' => 'https://public@example.invalid/1' ) ) ) )->serialize( $event );
	}

	/**
	 * Create an exception in a method that receives the marker as an
	 * argument; its trace is recorded where it is created.
	 *
	 * @param string $secret Marker passed as a stack argument.
	 * @return \RuntimeException
	 */
	private function throw_with( $secret ) {
		return new \RuntimeException( "Mollie said {$secret}" );
	}
}
