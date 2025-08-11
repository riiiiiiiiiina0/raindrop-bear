# Covers/icons

In your app you could easily make icon/cover selector from more than 10 000 icons

![](https://3611960587-files.gitbook.io/~/files/v0/b/gitbook-legacy-files/o/assets%2F-M-GPP1TyNN8gNuijaj7%2F-M-of5es4601IU9HtzYf%2F-M-ogjIOcDvx33liprkE%2Ficon%20finder.png?alt=media&token=4a945b4a-4fad-4671-bea9-43494e3e9136)

## Search for cover

<mark style="color:blue;">`GET`</mark> `https://api.raindrop.io/rest/v1/collections/covers/{text}`

Search for specific cover (icon)

#### Path Parameters

| Name | Type   | Description           |
| ---- | ------ | --------------------- |
| text | string | For example "pokemon" |

{% tabs %}
{% tab title="200 " %}

```javascript
{
  "items": [
    {
      "title": "Icons8",
      "icons": [
        {
          "png": "https://rd-icons-icons8.gumlet.com/color/5x/mystic-pokemon.png?fill-color=transparent"
        }
      ]
    },
    {
      "title": "Iconfinder",
      "icons": [
        {
          "png": "https://cdn4.iconfinder.com/data/icons/pokemon-go/512/Pokemon_Go-01-128.png",
          "svg": "https://api.iconfinder.com/v2/icons/1320040/formats/svg/1760420/download"
        }
      ]
    }
  ],
  "result": true
}
```

{% endtab %}
{% endtabs %}

## Featured covers

<mark style="color:blue;">`GET`</mark> `https://api.raindrop.io/rest/v1/collections/covers`

#### Path Parameters

| Name | Type   | Description |
| ---- | ------ | ----------- |
|      | string |             |

{% tabs %}
{% tab title="200 " %}

```javascript
{
  "items": [
    {
      "title": "Colors circle",
      "icons": [
        {
          "png": "https://up.raindrop.io/collection/templates/colors/ios1.png"
        }
      ]
    },
    {
      "title": "Hockey",
      "icons": [
        {
          "png": "https://up.raindrop.io/collection/templates/hockey-18/12i.png"
        }
      ]
    }
  ]
}
```

{% endtab %}
{% endtabs %}
