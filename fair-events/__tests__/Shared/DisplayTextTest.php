<?php
/**
 * Tests for the vendored FairEventsShared\Helpers\DisplayText (#2300).
 *
 * @package FairEvents
 */

namespace FairEventsShared\Tests\Helpers;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use FairEventsShared\Helpers\DisplayText;

/**
 * Tests single-pass entity decoding, event-title fallbacks and HTML escaping.
 */
class DisplayTextTest extends TestCase {

	const NBSP = "\u{00A0}";

	/**
	 * Stored value → decoded text.
	 *
	 * @return array<string, array{0: mixed, 1: string}>
	 */
	public static function decode_cases() {
		return array(
			'reported transaction'    => array(
				'Entrada para Minifesti "La&nbsp;Mutable", 22 de noviembre',
				'Entrada para Minifesti "La' . self::NBSP . 'Mutable", 22 de noviembre',
			),
			'ampersand'               => array( 'Rock &amp; Roll', 'Rock & Roll' ),
			'quotes'                  => array( '&quot;Q&quot; &#039;x&#039; &apos;y&apos;', '"Q" \'x\' \'y\'' ),
			'numeric and texturized'  => array( '&#8220;Caf&eacute;&#8221; &#x2014; ñ', '“Café” — ñ' ),
			'unicode unchanged'       => array( 'Zażółć gęślą jaźń 🎉', 'Zażółć gęślą jaźń 🎉' ),
			'html-like stays literal' => array( '&lt;b&gt;Bold&lt;/b&gt; <i>x</i>', '<b>Bold</b> <i>x</i>' ),
			'decodes only once'       => array( 'Use &amp;nbsp; and &amp;amp;', 'Use &nbsp; and &amp;' ),
			'not trimmed'             => array( '  a  ', '  a  ' ),
			'null'                    => array( null, '' ),
			'integer'                 => array( 42, '42' ),
			'array'                   => array( array( 'x' ), '' ),
		);
	}

	/**
	 * Decodes entities once.
	 *
	 * @param mixed  $value    Stored value.
	 * @param string $expected Decoded text.
	 */
	#[DataProvider( 'decode_cases' )]
	public function test_decode( $value, $expected ) {
		$this->assertSame( $expected, DisplayText::decode( $value ) );
	}

	/**
	 * Event titles are decoded and trimmed, with the caller's fallback.
	 */
	public function test_event_title() {
		$this->assertSame( 'La' . self::NBSP . 'Mutable & Co', DisplayText::event_title( ' La&nbsp;Mutable &amp; Co ', 'Untitled' ) );
		$this->assertSame( 'Untitled', DisplayText::event_title( '', 'Untitled' ) );
		$this->assertSame( 'Untitled', DisplayText::event_title( " \n ", 'Untitled' ) );
		$this->assertSame( 'Untitled', DisplayText::event_title( '&nbsp;', 'Untitled' ) );
		$this->assertSame( 'Untitled', DisplayText::event_title( null, 'Untitled' ) );
		$this->assertSame( '', DisplayText::event_title( null ) );
		$this->assertSame( '&lt;tag&gt;', DisplayText::event_title( '&amp;lt;tag&amp;gt;', 'Untitled' ) );
	}

	/**
	 * HTML escaping of decoded text keeps literal entities literal.
	 */
	public function test_html() {
		$this->assertSame( '&lt;b&gt; &amp; &amp;lt; &quot;q&quot; &#039;s&#039;', DisplayText::html( '<b> & &lt; "q" \'s\'' ) );
		$this->assertSame(
			'&amp;lt;tag&amp;gt;',
			DisplayText::html( DisplayText::decode( '&amp;lt;tag&amp;gt;' ) )
		);
	}
}
