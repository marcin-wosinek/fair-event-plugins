<?php
/**
 * SaleAlertFormatter unit tests.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Notifications;

use FairEvents\Notifications\SaleAlertFormatter;
use PHPUnit\Framework\TestCase;

/**
 * Tests the Telegram HTML of a ticket sale alert (#2448).
 */
class SaleAlertFormatterTest extends TestCase {

	/**
	 * A sale with two ticket types.
	 *
	 * @param array $overrides Fields to replace.
	 * @return array
	 */
	private static function sale( array $overrides = array() ) {
		return array_merge(
			array(
				'title'    => 'Spring Gala',
				'dates'    => array( 'Friday, May 1, 2026 at 7:00 pm' ),
				'tickets'  => array(
					array(
						'name'     => 'Adult',
						'quantity' => 2,
					),
					array(
						'name'     => 'Child',
						'quantity' => 1,
					),
				),
				'amount'   => 45.5,
				'currency' => 'EUR',
			),
			$overrides
		);
	}

	/**
	 * The message names the event, each ticket type with its quantity and
	 * the charged total with its currency, with its own formatting kept.
	 *
	 * @return void
	 */
	public function test_describes_the_purchase() {
		$html = SaleAlertFormatter::html( self::sale() );

		$this->assertSame(
			implode(
				"\n",
				array(
					'<b>New ticket sale</b>',
					'<b>Spring Gala</b>',
					'Friday, May 1, 2026 at 7:00 pm',
					'',
					'2 × Adult',
					'1 × Child',
					'',
					'Total: 45.50 EUR',
				)
			),
			$html
		);
	}

	/**
	 * `La&nbsp;Mutable` reads as "La Mutable" with a non-breaking space,
	 * decoded once: no entity is shown, and the formatting is kept (#2450).
	 *
	 * @return void
	 */
	public function test_decodes_entities_in_the_title_once() {
		$html  = SaleAlertFormatter::html( self::sale( array( 'title' => 'La&nbsp;Mutable' ) ) );
		$lines = explode( "\n", $html );

		$this->assertSame( "<b>La\u{00A0}Mutable</b>", $lines[1] );
		$this->assertStringNotContainsString( '&nbsp;', $html );
		$this->assertSame( '<b>New ticket sale</b>', $lines[0] );

		// Text meant to show an entity stays literal: decoded once only.
		$lines = explode( "\n", SaleAlertFormatter::html( self::sale( array( 'title' => 'Tom &amp;lt;3 Jerry' ) ) ) );
		$this->assertSame( '<b>Tom &amp;lt;3 Jerry</b>', $lines[1] );
	}

	/**
	 * Tag-like text in titles and ticket names is escaped, so only the
	 * message's own tags are markup.
	 *
	 * @return void
	 */
	public function test_escapes_tag_like_text() {
		$html  = SaleAlertFormatter::html(
			self::sale(
				array(
					'title'   => '<i>Rock</i> &amp; <a href="x">Roll</a>',
					'tickets' => array(
						array(
							'name'     => '<b>VIP</b>',
							'quantity' => 1,
						),
					),
				)
			)
		);
		$lines = explode( "\n", $html );

		$this->assertSame( '<b>&lt;i&gt;Rock&lt;/i&gt; &amp; &lt;a href=&quot;x&quot;&gt;Roll&lt;/a&gt;</b>', $lines[1] );
		$this->assertSame( '1 × &lt;b&gt;VIP&lt;/b&gt;', $lines[4] );
		$this->assertSame( 2, substr_count( $html, '<b>' ) );
	}

	/**
	 * A missing title and ticket name get readable fallbacks.
	 *
	 * @return void
	 */
	public function test_fallbacks() {
		$lines = explode(
			"\n",
			SaleAlertFormatter::html(
				self::sale(
					array(
						'title'   => " \u{00A0}",
						'dates'   => array(),
						'tickets' => array(
							array(
								'name'     => '',
								'quantity' => 3,
							),
						),
					)
				)
			)
		);

		$this->assertSame( '<b>(untitled event)</b>', $lines[1] );
		$this->assertSame( '3 × Ticket', $lines[3] );
	}

	/**
	 * A long series lists its first dates and counts the rest.
	 *
	 * @return void
	 */
	public function test_caps_long_date_lists() {
		$dates = array();
		for ( $i = 1; $i <= 14; $i++ ) {
			$dates[] = "Day {$i}";
		}
		$lines = explode( "\n", SaleAlertFormatter::html( self::sale( array( 'dates' => $dates ) ) ) );

		$this->assertSame( 'Day 9', $lines[10] );
		$this->assertSame( 'and 5 more', $lines[11] );
		$this->assertSame( '', $lines[12] );
	}

	/**
	 * The buyer is never part of the message.
	 *
	 * @return void
	 */
	public function test_never_includes_buyer_fields() {
		$html = SaleAlertFormatter::html(
			self::sale(
				array(
					'name'  => 'Ana Ruiz',
					'email' => 'ana@example.com',
				)
			)
		);

		$this->assertStringNotContainsString( 'Ana', $html );
		$this->assertStringNotContainsString( 'example.com', $html );
	}

	/**
	 * A digest of many events stays under Telegram's length limit and
	 * counts the events it leaves out; titles stay escaped.
	 *
	 * @return void
	 */
	public function test_digest_fits_telegram_and_counts_the_rest() {
		$sales = array();
		for ( $i = 1; $i <= 80; $i++ ) {
			$sales[] = array(
				'event_id' => $i,
				'title'    => 'Workshop <b>' . $i . '</b> with a fairly long descriptive title',
				'dates'    => array( 'Saturday 5 December 2026, 10:00–12:00' ),
				'tickets'  => array(
					array(
						'ticket_type_id' => 1,
						'name'           => 'Regular',
						'quantity'       => 1,
					),
				),
				'amount'   => 10,
				'currency' => 'EUR',
			);
		}

		$html = SaleAlertFormatter::digest_html( $sales );

		$this->assertLessThanOrEqual( 4096, mb_strlen( $html ) );
		$this->assertStringContainsString( '80 sales, total: 800.00 EUR', $html );
		$this->assertMatchesRegularExpression( '/and \d+ more events$/', $html );
		$this->assertStringContainsString( 'Workshop &lt;b&gt;1&lt;/b&gt;', $html );
	}

	/**
	 * The test message is labelled, names the site decoded once and
	 * escaped, and carries no sale.
	 *
	 * @return void
	 */
	public function test_test_message_names_the_site_only() {
		$GLOBALS['_fair_test_bloginfo'] = array( 'name' => 'La&nbsp;Mutable <b>&amp; friends</b>' );
		$html                           = SaleAlertFormatter::test_html();
		unset( $GLOBALS['_fair_test_bloginfo'] );

		$lines = explode( "\n", $html );
		$this->assertSame( '<b>Test message</b>', $lines[0] );
		$this->assertSame( "Ticket sale alerts from La\u{00A0}Mutable &lt;b&gt;&amp; friends&lt;/b&gt; will be posted here.", $lines[1] );
		$this->assertSame( 'This is only a test: no ticket was sold.', $lines[2] );
		$this->assertStringNotContainsString( 'Total', $html );
	}
}
